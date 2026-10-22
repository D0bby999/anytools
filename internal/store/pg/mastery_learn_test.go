package pg_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/capabilities/mastery"
	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/learning/loop"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// seedExplainBack gives user a path with one concept point and one judged
// explain-back attempt at it, returning the attempt, the point and the path.
func seedExplainBack(t *testing.T, ctx context.Context, pool *pgxpool.Pool, user uuid.UUID) (attempt, kp, path uuid.UUID) {
	t.Helper()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("seed explain-back: %v", err)
		}
	}
	var kb, module uuid.UUID
	must(pool.QueryRow(ctx, `INSERT INTO knowledge_bases (user_id, name) VALUES ($1, 'Explain KB') RETURNING id`, user).Scan(&kb))
	must(pool.QueryRow(ctx, `INSERT INTO mastery_paths (user_id, kb_id, goal) VALUES ($1, $2, 'g') RETURNING id`, user, kb).Scan(&path))
	must(pool.QueryRow(ctx, `INSERT INTO mastery_modules (user_id, path_id, ord, name) VALUES ($1, $2, 0, 'm') RETURNING id`, user, path).Scan(&module))
	must(pool.QueryRow(ctx, `INSERT INTO knowledge_points (user_id, module_id, name, type)
		VALUES ($1, $2, 'Parametric memory', 'concept') RETURNING id`, user, module).Scan(&kp))
	must(pool.QueryRow(ctx, `INSERT INTO explain_back_attempts (user_id, kp_id, path_id, request_id, explanation, verdict, judged_at)
		VALUES ($1, $2, $3, $4, 'Knowledge kept in the weights of the model.', 'passed', now()) RETURNING id`,
		user, kp, path, uuid.New()).Scan(&attempt))
	return attempt, kp, path
}

// ── fixture ──────────────────────────────────────────────────────────────

type learnFixture struct {
	pool   *pgxpool.Pool
	store  *pg.MasteryStore
	qs     *pg.QuestionStore
	user   uuid.UUID
	kb     uuid.UUID
	path   uuid.UUID
	module uuid.UUID
	kp     uuid.UUID
	now    time.Time
}

// newLearnFixture plans a path of one module holding one concept point, with
// a bar of 0.5, for a fresh user. gated says whether the path is gated.
func newLearnFixture(t *testing.T, gated bool) (context.Context, *learnFixture) {
	t.Helper()
	ctx := context.Background()
	pool := testutil.TestDB(t)
	f := &learnFixture{pool: pool, store: pg.NewMasteryStore(pool), qs: pg.NewQuestionStore(pool),
		user: testutil.NewUser(t, pool), now: time.Now().UTC()}
	if err := pool.QueryRow(ctx, `INSERT INTO knowledge_bases (user_id, name) VALUES ($1, 'KB') RETURNING id`, f.user).Scan(&f.kb); err != nil {
		t.Fatal(err)
	}
	path, err := f.store.CreatePath(ctx, mastery.Path{UserID: f.user, KBID: f.kb, Goal: "g"})
	if err != nil {
		t.Fatal(err)
	}
	f.path = path.ID
	if !gated {
		// A path from before the migration: the column's backfill value.
		if _, err := pool.Exec(ctx, `UPDATE mastery_paths SET explain_gate = false WHERE id = $1`, f.path); err != nil {
			t.Fatal(err)
		}
	}
	detail, err := f.store.ApproveModules(ctx, f.user, f.path, []mastery.ProposedModule{{
		Name: "Memory", PassThreshold: 0.5,
		KnowledgePoints: []mastery.ProposedKP{{Name: "Parametric memory", Type: "concept"}},
	}}, f.now)
	if err != nil {
		t.Fatal(err)
	}
	f.module = detail.Modules[0].Module.ID
	f.kp = detail.Modules[0].KnowledgePoints[0].KnowledgePoint.ID
	return ctx, f
}

// masteredButUnexplained puts the point over its bar and out of the due list,
// so the explain gate is the only thing between the module and graduation.
func (f *learnFixture) masteredButUnexplained(t *testing.T, ctx context.Context) {
	t.Helper()
	if _, err := f.pool.Exec(ctx, `UPDATE kp_state SET mastery_estimate = 0.8, due_at = $2 WHERE kp_id = $1`,
		f.kp, f.now.Add(48*time.Hour)); err != nil {
		t.Fatal(err)
	}
}

func (f *learnFixture) reserve(t *testing.T, ctx context.Context) uuid.UUID {
	t.Helper()
	a, created, err := f.store.ReserveExplainBack(ctx, mastery.ExplainBackAttempt{
		UserID: f.user, KnowledgePointID: f.kp, PathID: f.path, RequestID: uuid.New(),
		Explanation: "Parametric memory is what the weights hold.",
	})
	if err != nil || !created {
		t.Fatalf("reserve: %v (created %v)", err, created)
	}
	return a.ID
}

func (f *learnFixture) judge(t *testing.T, ctx context.Context, verdict string) (*mastery.ExplainBackAttempt, *quiz.Scheduled) {
	t.Helper()
	a, s, err := f.store.RecordExplainVerdict(ctx, f.user, f.reserve(t, ctx), mastery.ExplainVerdict{
		Verdict: verdict, Gaps: []string{"say where it lives"}, Model: "fake-1"}, f.now)
	if err != nil {
		t.Fatalf("RecordExplainVerdict(%s): %v", verdict, err)
	}
	return a, s
}

type kpRow struct {
	Reviews  int
	Estimate float64
	Status   string
	Passed   *time.Time
	Reps     int
	DueAt    time.Time
}

func (f *learnFixture) state(t *testing.T, ctx context.Context) kpRow {
	t.Helper()
	var r kpRow
	if err := f.pool.QueryRow(ctx, `
		SELECT reviews, mastery_estimate, status, explain_passed_at, (fsrs_card->>'Reps')::int, due_at
		  FROM kp_state WHERE kp_id = $1`, f.kp).
		Scan(&r.Reviews, &r.Estimate, &r.Status, &r.Passed, &r.Reps, &r.DueAt); err != nil {
		t.Fatal(err)
	}
	return r
}

// ── the gate ─────────────────────────────────────────────────────────────

func TestAGatedModuleGraduatesOnlyOnceItsConceptPointIsExplained(t *testing.T) {
	ctx, f := newLearnFixture(t, true)
	f.masteredButUnexplained(t, ctx)

	if got, err := f.store.Graduate(ctx, f.user, f.path, f.now); err != nil || len(got) != 0 {
		t.Fatalf("Graduate before an explain-back = %+v, %v; want nothing", got, err)
	}
	f.judge(t, ctx, mastery.VerdictFailed)
	if got, _ := f.store.Graduate(ctx, f.user, f.path, f.now); len(got) != 0 {
		t.Fatalf("Graduate after a FAILED explain-back = %+v; want nothing", got)
	}
	// A failure reschedules the point soon — never later than the next
	// local day — so the module is not "not due" by accident either.
	st := f.state(t, ctx)
	if st.Passed != nil || !st.DueAt.Before(f.now.Add(25*time.Hour)) {
		t.Fatalf("after a failure: %+v; want no pass and a near due date", st)
	}
	// Put it out of the due list again, then pass.
	f.masteredButUnexplained(t, ctx)
	if _, s := f.judge(t, ctx, mastery.VerdictPassed); s == nil || s.Rating != "good" {
		t.Fatalf("a pass is rated good, got %+v", s)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE kp_state SET due_at = $2 WHERE kp_id = $1`, f.kp, f.now.Add(48*time.Hour)); err != nil {
		t.Fatal(err)
	}
	got, err := f.store.Graduate(ctx, f.user, f.path, f.now)
	if err != nil || len(got) != 1 || got[0].ModuleID != f.module {
		t.Fatalf("Graduate after a pass = %+v, %v; want the module", got, err)
	}
}

func TestAPathFromBeforeTheMigrationGraduatesWithoutAnExplainBack(t *testing.T) {
	ctx, f := newLearnFixture(t, false)
	f.masteredButUnexplained(t, ctx)
	got, err := f.store.Graduate(ctx, f.user, f.path, f.now)
	if err != nil || len(got) != 1 {
		t.Fatalf("Graduate on an ungated path = %+v, %v; want the module", got, err)
	}
	// On such a path an explain-back still counts: evidence and a rating.
	_, s := f.judge(t, ctx, mastery.VerdictPassed)
	if s == nil || f.state(t, ctx).Passed == nil {
		t.Fatal("an explain-back on an older path did not rate the point")
	}
}

// ── one write path, under the lock ──────────────────────────────────────

func TestRateKnowledgePointHoldsTheRowLock(t *testing.T) {
	ctx, f := newLearnFixture(t, true)
	const n = 8
	ids := make([]uuid.UUID, n)
	for i := range ids {
		ids[i] = f.reserve(t, ctx)
	}
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for _, id := range ids {
		wg.Add(1)
		go func(id uuid.UUID) {
			defer wg.Done()
			_, err := f.store.RateKnowledgePoint(ctx, f.user, f.kp, "good",
				pg.RatingSource{Kind: loop.KindExplainBack, ID: id}, f.now)
			errs <- err
		}(id)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("RateKnowledgePoint: %v", err)
		}
	}
	// FSRS state is a fold over reviews. Without the lock, concurrent ratings
	// read the same card and the later write discards the earlier review.
	if st := f.state(t, ctx); st.Reps != n || st.Reviews != n {
		t.Fatalf("after %d concurrent ratings the card has %d reps and %d reviews", n, st.Reps, st.Reviews)
	}
}

func TestAQuizOverrideDoesNotUndoALaterExplainBack(t *testing.T) {
	ctx, f := newLearnFixture(t, true)
	qs, err := f.qs.InsertQuestions(ctx, []quiz.Question{{UserID: f.user, KBID: f.kb, KnowledgePointID: &f.kp,
		ModuleID: &f.module, Prompt: "Where?", Type: quiz.TypeShort, Answer: "weights", Difficulty: quiz.DifficultyEasy}})
	if err != nil {
		t.Fatal(err)
	}
	attempt, _, err := f.qs.RecordAttempt(ctx, quiz.AttemptWrite{UserID: f.user, QuestionID: qs[0].ID,
		KnowledgePointID: &f.kp, ModuleID: &f.module, UserAnswer: "index", IsCorrect: false,
		Judge: []byte(`{}`), Rating: "again", Now: f.now})
	if err != nil {
		t.Fatal(err)
	}
	f.judge(t, ctx, mastery.VerdictPassed)
	before := f.state(t, ctx)

	if _, _, err := f.qs.OverrideAttempt(ctx, f.user, attempt.ID, true, "disputed", f.now); err != nil {
		t.Fatalf("OverrideAttempt: %v", err)
	}
	after := f.state(t, ctx)
	if after.Reviews != before.Reviews || after.Reps != before.Reps || after.Passed == nil {
		t.Fatalf("the quiz override replayed over the explain-back: before %+v after %+v", before, after)
	}
}

func TestAnExplainBackOverrideReplaysOnceAndIsTheLearners(t *testing.T) {
	ctx, f := newLearnFixture(t, true)
	failed, _ := f.judge(t, ctx, mastery.VerdictFailed)
	if f.state(t, ctx).Passed != nil {
		t.Fatal("a failure set explain_passed_at")
	}

	got, sched, err := f.store.OverrideExplainBack(ctx, f.user, failed.ID, f.now)
	if err != nil {
		t.Fatalf("OverrideExplainBack: %v", err)
	}
	// The judge's verdict is kept; the learner's sits beside it.
	if got.Verdict != mastery.VerdictFailed || got.OverridePassed == nil || !*got.OverridePassed || !got.EffectivePassed() {
		t.Fatalf("override = %+v", got)
	}
	st := f.state(t, ctx)
	if sched == nil || st.Passed == nil || st.Reviews != 1 {
		t.Fatalf("replayed state %+v (scheduled %+v); want one review, passed", st, sched)
	}
	if _, _, err := f.store.OverrideExplainBack(ctx, f.user, failed.ID, f.now); !errors.Is(err, mastery.ErrBadRequest) {
		t.Fatalf("second override: err = %v, want ErrBadRequest", err)
	}
}

func TestAnUnjudgedVerdictChangesNoSchedule(t *testing.T) {
	ctx, f := newLearnFixture(t, true)
	before := f.state(t, ctx)
	a, s, err := f.store.RecordExplainVerdict(ctx, f.user, f.reserve(t, ctx),
		mastery.ExplainVerdict{Verdict: mastery.VerdictUnjudged, Feedback: "could not judge"}, f.now)
	if err != nil || s != nil || a.Passed {
		t.Fatalf("unjudged: %+v, %+v, %v", a, s, err)
	}
	if after := f.state(t, ctx); after.Reviews != before.Reviews || after.Reps != before.Reps {
		t.Fatalf("an unjudged reply moved the schedule: %+v → %+v", before, after)
	}
	// And it is not an explain-back the session waits on.
	if _, _, err := f.store.OverrideExplainBack(ctx, f.user, a.ID, f.now); !errors.Is(err, mastery.ErrBadRequest) {
		t.Fatalf("overriding an unjudged verdict: err = %v, want ErrBadRequest", err)
	}
}

// ── ids ──────────────────────────────────────────────────────────────────

func TestExplainBackRequestIDIsPerUser(t *testing.T) {
	ctx, alice := newLearnFixture(t, true)
	_, bob := newLearnFixture(t, true)
	shared := uuid.New()
	a, created, err := alice.store.ReserveExplainBack(ctx, mastery.ExplainBackAttempt{UserID: alice.user,
		KnowledgePointID: alice.kp, PathID: alice.path, RequestID: shared, Explanation: "Alice's own explanation."})
	if err != nil || !created {
		t.Fatal(err)
	}
	b, created, err := bob.store.ReserveExplainBack(ctx, mastery.ExplainBackAttempt{UserID: bob.user,
		KnowledgePointID: bob.kp, PathID: bob.path, RequestID: shared, Explanation: "Bob's own explanation here."})
	if err != nil || !created || b.ID == a.ID || b.Explanation == a.Explanation {
		t.Fatalf("Bob's request with Alice's key: %+v (created %v, %v); want his own new row", b, created, err)
	}
	// Bob naming Alice's point cannot even reserve.
	if _, _, err := bob.store.ReserveExplainBack(ctx, mastery.ExplainBackAttempt{UserID: bob.user,
		KnowledgePointID: alice.kp, PathID: bob.path, RequestID: uuid.New(), Explanation: "Bob on Alice's point."}); !errors.Is(err, mastery.ErrNotFound) {
		t.Fatalf("Bob reserving on Alice's point: err = %v, want ErrNotFound", err)
	}
	if _, err := bob.store.LatestExplainBack(ctx, bob.user, alice.kp); !errors.Is(err, mastery.ErrNotFound) {
		t.Fatalf("Bob reading Alice's point's attempts: err = %v", err)
	}
	if _, _, err := bob.store.OverrideExplainBack(ctx, bob.user, a.ID, bob.now); !errors.Is(err, mastery.ErrNotFound) {
		t.Fatalf("Bob overriding Alice's attempt: err = %v", err)
	}
}

// ── cache staleness ──────────────────────────────────────────────────────

func TestBumpingACitedDocumentsVersionMarksTheExplanationStale(t *testing.T) {
	ctx, f := newLearnFixture(t, true)
	var doc uuid.UUID
	if err := f.pool.QueryRow(ctx, `
		INSERT INTO documents (user_id, kb_id, source_kind, title, mime, bytes, sha256, status)
		VALUES ($1, $2, 'upload', 'rag.pdf', 'application/pdf', 1, $3, 'ready') RETURNING id`,
		f.user, f.kb, strings.Repeat("c", 64)).Scan(&doc); err != nil {
		t.Fatal(err)
	}
	versions, err := f.store.DocumentVersions(ctx, f.user, []uuid.UUID{doc})
	if err != nil || len(versions) != 1 || versions[0].Version != 1 {
		t.Fatalf("versions = %+v, %v", versions, err)
	}
	if _, err := f.store.SaveExplanation(ctx, mastery.Explanation{UserID: f.user, KnowledgePointID: f.kp,
		Model: "fake-1", BodyMD: "It lives in the weights."}, versions); err != nil {
		t.Fatal(err)
	}
	read := func() *mastery.Explanation {
		e, err := f.store.Explanation(ctx, f.user, f.kp, "fake-1", 0, "")
		if err != nil {
			t.Fatal(err)
		}
		return e
	}
	if read().Stale {
		t.Fatal("a fresh explanation reads as stale")
	}
	if _, err := f.pool.Exec(ctx, `UPDATE documents SET version = version + 1 WHERE id = $1`, doc); err != nil {
		t.Fatal(err)
	}
	if !read().Stale {
		t.Fatal("a re-parsed source did not mark the explanation stale")
	}
	// Another user's copy of the key reads nothing.
	if _, err := f.store.Explanation(ctx, uuid.New(), f.kp, "fake-1", 0, ""); !errors.Is(err, mastery.ErrNotFound) {
		t.Fatalf("a stranger's read: err = %v", err)
	}
}
