package profile_test

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/learning/profile"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// job_test.go — the nightly consolidation against the real store: opt-in,
// skipped without new activity or without a model, advisory-locked, once a
// night at 02:00 in the learner's zone, and proposals only.

// scoped is the real store with OptedIn narrowed to this test's learners:
// the test database is shared, and another test's learner must not be
// consolidated (or counted) here.
type scoped struct {
	*pg.ProfileStore
	users map[uuid.UUID]bool
}

func (s scoped) OptedIn(ctx context.Context) ([]profile.Learner, error) {
	all, err := s.ProfileStore.OptedIn(ctx)
	var out []profile.Learner
	for _, l := range all {
		if s.users[l.UserID] {
			out = append(out, l)
		}
	}
	return out, err
}

// scriptedModel answers the consolidation call and records what it was sent.
type scriptedModel struct {
	mu     sync.Mutex
	inputs []string
	reply  string
}

func (m *scriptedModel) Chat(_ context.Context, req runtime.ChatRequest) (*runtime.ChatResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.inputs = append(m.inputs, req.Messages[len(req.Messages)-1].Content)
	return &runtime.ChatResponse{Content: m.reply}, nil
}

func (m *scriptedModel) ChatStream(ctx context.Context, req runtime.ChatRequest, _ func(runtime.StreamChunk)) (*runtime.ChatResponse, error) {
	return m.Chat(ctx, req)
}
func (m *scriptedModel) DefaultModel() string { return "fake-1" }
func (m *scriptedModel) Name() string         { return "fake" }

func (m *scriptedModel) calls() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.inputs)
}

type resolver struct {
	model  *scriptedModel
	routed map[uuid.UUID]bool
}

func (r resolver) ChatFor(_ context.Context, userID uuid.UUID, function string) (runtime.ChatProvider, error) {
	if function != "chat" || !r.routed[userID] {
		return nil, runtime.ErrNoProvider
	}
	return r.model, nil
}

type jobFixture struct {
	pool  *pgxpool.Pool
	store *pg.ProfileStore
	model *scriptedModel
	job   *profile.Job
	users map[uuid.UUID]bool
	route map[uuid.UUID]bool
	now   time.Time
}

func newJobFixture(t *testing.T) *jobFixture {
	t.Helper()
	pool := testutil.TestDB(t)
	f := &jobFixture{pool: pool, store: pg.NewProfileStore(pool), model: &scriptedModel{},
		users: map[uuid.UUID]bool{}, route: map[uuid.UUID]bool{}}
	f.job = profile.NewJob(pool, scoped{f.store, f.users}, resolver{f.model, f.route})
	// 02:30 in Hanoi.
	f.now = time.Date(2026, 9, 27, 19, 30, 0, 0, time.UTC)
	f.job.SetClock(func() time.Time { return f.now })
	return f
}

// learner is a Hanoi learner with one knowledge point, a wrong answer on it
// an hour ago when active, opted in when on, and a chat route when routed.
func (f *jobFixture) learner(t *testing.T, on, active, routed bool) (user, kp uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	user = testutil.NewUser(t, f.pool)
	f.users[user], f.route[user] = true, routed
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	_, err := f.pool.Exec(ctx, `UPDATE users SET timezone = 'Asia/Ho_Chi_Minh', profile_consolidation = $2 WHERE id = $1`, user, on)
	must(err)
	var kb, path, module, q uuid.UUID
	must(f.pool.QueryRow(ctx, `INSERT INTO knowledge_bases (user_id, name) VALUES ($1, 'Retrieval papers') RETURNING id`, user).Scan(&kb))
	must(f.pool.QueryRow(ctx, `INSERT INTO mastery_paths (user_id, kb_id, goal) VALUES ($1, $2, 'g') RETURNING id`, user, kb).Scan(&path))
	must(f.pool.QueryRow(ctx, `INSERT INTO mastery_modules (user_id, path_id, ord, name) VALUES ($1, $2, 0, 'm') RETURNING id`, user, path).Scan(&module))
	must(f.pool.QueryRow(ctx, `INSERT INTO knowledge_points (user_id, module_id, name) VALUES ($1, $2, 'Parametric memory') RETURNING id`, user, module).Scan(&kp))
	must(f.pool.QueryRow(ctx, `INSERT INTO questions (user_id, kb_id, knowledge_point_id, prompt, type, answer)
		VALUES ($1, $2, $3, 'p', 'short', 'a') RETURNING id`, user, kb, kp).Scan(&q))
	if active {
		at := f.now.Add(-time.Hour)
		_, err = f.pool.Exec(ctx, `INSERT INTO question_attempts (user_id, question_id, knowledge_point_id, is_correct, rating, created_at)
			VALUES ($1, $2, $3, false, 'again', $4)`, user, q, kp, at)
		must(err)
		_, err = f.pool.Exec(ctx, `INSERT INTO error_records (user_id, question_id, kp_id, error_type, created_at, updated_at)
			VALUES ($1, $2, $3, 'recall', $4, $4)`, user, q, kp, at)
		must(err)
	}
	return user, kp
}

func (f *jobFixture) runs(t *testing.T, user uuid.UUID) []profile.Run {
	t.Helper()
	runs, err := f.store.Runs(context.Background(), user, 10)
	if err != nil {
		t.Fatal(err)
	}
	return runs
}

func reply(ops ...map[string]any) string {
	raw, _ := json.Marshal(map[string]any{"operations": ops})
	return "```json\n" + string(raw) + "\n```"
}

func TestConsolidationDoesNothingForALearnerWhoHasNotOptedIn(t *testing.T) {
	f := newJobFixture(t)
	user, _ := f.learner(t, false, true, true)
	if _, ran, err := f.job.RunOnce(context.Background()); err != nil || !ran {
		t.Fatalf("RunOnce: ran %v, %v", ran, err)
	}
	if f.model.calls() != 0 || len(f.runs(t, user)) != 0 {
		t.Fatalf("an opted-out learner: %d calls, %d runs", f.model.calls(), len(f.runs(t, user)))
	}
	// The real OptedIn (not the scoped one) does not list them either.
	all, err := f.store.OptedIn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, l := range all {
		if l.UserID == user {
			t.Fatal("OptedIn lists a learner whose switch is off")
		}
	}
}

func TestConsolidationSkipsANightWithNoNewActivityOrNoModel(t *testing.T) {
	f := newJobFixture(t)
	idle, _ := f.learner(t, true, false, true)
	unrouted, _ := f.learner(t, true, true, false)
	if _, _, err := f.job.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.model.calls() != 0 {
		t.Fatalf("%d model calls; both learners should have been skipped", f.model.calls())
	}
	for user, why := range map[uuid.UUID]string{idle: "no new activity", unrouted: "no model"} {
		runs := f.runs(t, user)
		if len(runs) != 1 || runs[0].Status != profile.RunSkipped || !strings.Contains(runs[0].Error, why) {
			t.Errorf("%s: runs = %+v", why, runs)
		}
	}
	// Skipped is recorded, so the next tick tonight does not ask again.
	f.now = f.now.Add(15 * time.Minute)
	if n, _, _ := f.job.RunOnce(context.Background()); n != 0 {
		t.Errorf("visited %d learners again the same night", n)
	}
}

func TestConsolidationProposesOnceANightAndOnlyAfterTwo(t *testing.T) {
	f := newJobFixture(t)
	user, kp := f.learner(t, true, true, true)
	f.model.reply = reply(
		map[string]any{"op": "add", "section": "struggles", "text": "Across recent answers on this point, recall mistakes recur.", "refs": []string{"S1"}},
		map[string]any{"op": "add", "section": "strengths", "text": "The learner has mastered everything.", "refs": []string{"S1"}},
		map[string]any{"op": "add", "section": "preferences", "text": "Prefers video.", "refs": []string{}},
	)

	// 01:30 in Hanoi: not yet.
	f.now = time.Date(2026, 9, 27, 18, 30, 0, 0, time.UTC)
	if n, _, _ := f.job.RunOnce(context.Background()); n != 0 || f.model.calls() != 0 {
		t.Fatalf("before 02:00: visited %d, %d calls", n, f.model.calls())
	}

	f.now = time.Date(2026, 9, 27, 19, 30, 0, 0, time.UTC)
	if n, _, err := f.job.RunOnce(context.Background()); err != nil || n != 1 || f.model.calls() != 1 {
		t.Fatalf("02:30: visited %d, %d calls, %v", n, f.model.calls(), err)
	}
	if in := f.model.inputs[0]; !strings.Contains(in, "S1 — knowledge point") || !strings.Contains(in, "recall 1") {
		t.Fatalf("model input:\n%s", in)
	}
	runs := f.runs(t, user)
	if len(runs) != 1 || runs[0].Status != profile.RunSucceeded || runs[0].Model != "fake-1" || len(runs[0].Ops) != 3 {
		t.Fatalf("runs = %+v", runs)
	}
	if runs[0].Ops[1].Status != "dropped" || runs[0].Ops[2].Status != "dropped" {
		t.Fatalf("ops = %+v; the absolute and the unevidenced statements must be dropped", runs[0].Ops)
	}

	entries, err := f.store.List(context.Background(), user)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Status != profile.StatusProposed || entries[0].Origin != profile.OriginConsolidated ||
		entries[0].Refs[0].ID != kp || entries[0].KBID == nil {
		t.Fatalf("entries = %+v; want one cited, KB-scoped proposal", entries)
	}

	// 03:00 the same night: not again.
	f.now = f.now.Add(30 * time.Minute)
	if n, _, _ := f.job.RunOnce(context.Background()); n != 0 || f.model.calls() != 1 {
		t.Fatalf("second pass the same night: visited %d, %d calls", n, f.model.calls())
	}
	// The next night with no new activity: skipped without a call.
	f.now = f.now.Add(24 * time.Hour)
	if n, _, _ := f.job.RunOnce(context.Background()); n != 1 || f.model.calls() != 1 {
		t.Fatalf("next night: visited %d, %d calls", n, f.model.calls())
	}
	if runs := f.runs(t, user); runs[0].Status != profile.RunSkipped {
		t.Fatalf("next night's run = %+v", runs[0])
	}
}

func TestConsolidationIsAdvisoryLocked(t *testing.T) {
	f := newJobFixture(t)
	user, _ := f.learner(t, true, true, true)
	f.model.reply = reply()
	ctx := context.Background()

	held := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, err := jobs.WithAdvisoryLock(ctx, f.pool, profile.ConsolidateLock, func(context.Context) error {
			close(held)
			<-release
			return nil
		})
		done <- err
	}()
	<-held
	_, ran, err := f.job.RunOnce(ctx)
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if err != nil || ran || f.model.calls() != 0 || len(f.runs(t, user)) != 0 {
		t.Fatalf("with the lock held elsewhere: ran %v, %d calls, %d runs, %v", ran, f.model.calls(), len(f.runs(t, user)), err)
	}
	if _, ran, err := f.job.RunOnce(ctx); !ran || err != nil || f.model.calls() != 1 {
		t.Fatalf("after release: ran %v, %d calls, %v", ran, f.model.calls(), err)
	}
}

func TestAnUnreadableReplyProposesNothing(t *testing.T) {
	f := newJobFixture(t)
	user, _ := f.learner(t, true, true, true)
	f.model.reply = "I think the learner is doing great!"
	if _, _, err := f.job.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	runs := f.runs(t, user)
	if len(runs) != 1 || runs[0].Status != profile.RunFailed || runs[0].Error == "" {
		t.Fatalf("runs = %+v", runs)
	}
	if entries, _ := f.store.List(context.Background(), user); len(entries) != 0 {
		t.Fatalf("entries from an unreadable reply: %+v", entries)
	}
	// Not due again the same night, failure or not.
	if n, _, _ := f.job.RunOnce(context.Background()); n != 0 {
		t.Fatal("a failed run was retried the same night")
	}
}

// A new run withdraws the previous run's unreviewed proposals and keeps what
// the learner decided.
func TestANewRunReplacesUnreviewedProposals(t *testing.T) {
	f := newJobFixture(t)
	user, _ := f.learner(t, true, true, true)
	ctx := context.Background()
	f.model.reply = reply(
		map[string]any{"op": "add", "section": "struggles", "text": "Recall mistakes recur on this point.", "refs": []string{"S1"}},
		map[string]any{"op": "add", "section": "studying", "text": "Recent quiz activity centres on retrieval.", "refs": []string{"S2"}},
	)
	if _, _, err := f.job.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	entries, _ := f.store.List(ctx, user)
	if len(entries) != 2 {
		t.Fatalf("first run entries = %+v", entries)
	}
	svc := profile.NewService(f.store, nil)
	var keep uuid.UUID
	for _, e := range entries {
		if e.Section == "struggles" {
			keep = e.ID
			if _, err := svc.Accept(ctx, user, e.ID); err != nil {
				t.Fatal(err)
			}
		}
	}

	// Next night, after new activity, the model proposes something else.
	f.now = f.now.Add(24 * time.Hour)
	if _, err := f.pool.Exec(ctx, `INSERT INTO mastery_events (user_id, path_id, revision, type, created_at)
		SELECT user_id, path_id, 99, 'x', $2 FROM mastery_modules WHERE user_id = $1 LIMIT 1`, user, f.now.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	f.model.reply = reply(
		map[string]any{"op": "update", "entry": "E1", "text": "Recall mistakes on this point have eased.", "refs": []string{"S1"}},
	)
	if _, _, err := f.job.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if in := f.model.inputs[len(f.model.inputs)-1]; !strings.Contains(in, "E1 — section struggles") {
		t.Fatalf("the accepted statement was not shown under a key:\n%s", in)
	}
	entries, _ = f.store.List(ctx, user)
	var texts []string
	for _, e := range entries {
		texts = append(texts, e.Status+":"+e.Text)
		if e.Op == profile.OpUpdate && (e.ReplacesID == nil || *e.ReplacesID != keep) {
			t.Errorf("update proposal targets %v, want %v", e.ReplacesID, keep)
		}
	}
	joined := strings.Join(texts, "|")
	if strings.Contains(joined, "centres on retrieval") || !strings.Contains(joined, "accepted:Recall mistakes recur") ||
		!strings.Contains(joined, "proposed:Recall mistakes on this point have eased.") {
		t.Fatalf("after the second run: %v", texts)
	}
}
