package pg_test

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// mistakes_test.go — learning-depth phase 1: every wrong answer opens a
// mistake, the second correct answer graduates it only on a later day in the
// learner's zone, and an override restores the mistake for any question.

const hcm = "Asia/Ho_Chi_Minh" // UTC+7

type mistakeFixture struct {
	pool  *pgxpool.Pool
	store *pg.QuestionStore
	user  uuid.UUID
	kb    uuid.UUID
}

func newMistakeFixture(t *testing.T) (context.Context, *mistakeFixture) {
	t.Helper()
	ctx := context.Background()
	pool := testutil.TestDB(t)
	f := &mistakeFixture{pool: pool, store: pg.NewQuestionStore(pool), user: testutil.NewUser(t, pool)}
	if _, err := pool.Exec(ctx, `UPDATE users SET timezone = $2 WHERE id = $1`, f.user, hcm); err != nil {
		t.Fatal(err)
	}
	kb, err := pg.NewKnowledgeStore(pool).CreateKB(ctx, f.user, "Mistakes KB")
	if err != nil {
		t.Fatal(err)
	}
	f.kb = kb.ID
	return ctx, f
}

func (f *mistakeFixture) question(t *testing.T, ctx context.Context, kp *uuid.UUID) uuid.UUID {
	t.Helper()
	qs, err := f.store.InsertQuestions(ctx, []quiz.Question{{
		UserID: f.user, KBID: f.kb, KnowledgePointID: kp, Prompt: "What does báo mean?",
		Type: quiz.TypeShort, Answer: "newspaper", Difficulty: quiz.DifficultyEasy,
	}})
	if err != nil {
		t.Fatal(err)
	}
	return qs[0].ID
}

// knowledgePoint seeds a path, a module and a point, returning the point and
// the path.
func (f *mistakeFixture) knowledgePoint(t *testing.T, ctx context.Context) (kp, path uuid.UUID) {
	t.Helper()
	var module uuid.UUID
	if err := f.pool.QueryRow(ctx, `INSERT INTO mastery_paths (user_id, kb_id, goal) VALUES ($1, $2, 'g') RETURNING id`,
		f.user, f.kb).Scan(&path); err != nil {
		t.Fatal(err)
	}
	if err := f.pool.QueryRow(ctx, `INSERT INTO mastery_modules (user_id, path_id, ord, name) VALUES ($1, $2, 0, 'm') RETURNING id`,
		f.user, path).Scan(&module); err != nil {
		t.Fatal(err)
	}
	if err := f.pool.QueryRow(ctx, `INSERT INTO knowledge_points (user_id, module_id, name) VALUES ($1, $2, 'k') RETURNING id`,
		f.user, module).Scan(&kp); err != nil {
		t.Fatal(err)
	}
	return kp, path
}

func (f *mistakeFixture) answer(t *testing.T, ctx context.Context, q uuid.UUID, kp *uuid.UUID, correct bool, at time.Time) uuid.UUID {
	t.Helper()
	rating := "again"
	if correct {
		rating = "good"
	}
	a, _, err := f.store.RecordAttempt(ctx, quiz.AttemptWrite{
		UserID: f.user, QuestionID: q, KnowledgePointID: kp, UserAnswer: "x",
		IsCorrect: correct, Judge: []byte(`{}`), Rating: rating, Now: at,
	})
	if err != nil {
		t.Fatalf("RecordAttempt: %v", err)
	}
	return a.ID
}

// mistake reads the question's records: open status ("" when none) and how
// many rows exist in all.
func (f *mistakeFixture) mistake(t *testing.T, ctx context.Context, q uuid.UUID) (open string, entries, rows int) {
	t.Helper()
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM error_records WHERE user_id = $1 AND question_id = $2`,
		f.user, q).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	err := f.pool.QueryRow(ctx, `
		SELECT status, jsonb_array_length(retry_history) FROM error_records
		 WHERE user_id = $1 AND question_id = $2 AND status <> 'graduated'`, f.user, q).Scan(&open, &entries)
	if err != nil && !strings.Contains(err.Error(), "no rows") {
		t.Fatal(err)
	}
	return open, entries, rows
}

func at(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestEveryWrongAnswerOpensAMistake(t *testing.T) {
	ctx, f := newMistakeFixture(t)
	now := time.Now()

	plain := f.question(t, ctx, nil)
	f.answer(t, ctx, plain, nil, false, now)
	if open, n, _ := f.mistake(t, ctx, plain); open != "active" || n != 1 {
		t.Fatalf("a plain quiz's wrong answer: status %q with %d entries, want active with 1", open, n)
	}
	f.answer(t, ctx, plain, nil, false, now)
	if open, n, rows := f.mistake(t, ctx, plain); open != "retrying" || n != 2 || rows != 1 {
		t.Fatalf("a second wrong answer: status %q, %d entries, %d rows; want retrying, 2, 1", open, n, rows)
	}

	kp, _ := f.knowledgePoint(t, ctx)
	withKP := f.question(t, ctx, &kp)
	f.answer(t, ctx, withKP, &kp, false, now)
	var gotKP *uuid.UUID
	if err := f.pool.QueryRow(ctx, `SELECT kp_id FROM error_records WHERE question_id = $1`, withKP).Scan(&gotKP); err != nil || gotKP == nil || *gotKP != kp {
		t.Fatalf("a mastery question's mistake names its point: %v, %v", gotKP, err)
	}

	// A question answered right the first time never opens one.
	right := f.question(t, ctx, nil)
	f.answer(t, ctx, right, nil, true, now)
	if _, _, rows := f.mistake(t, ctx, right); rows != 0 {
		t.Fatalf("a first-time correct answer opened %d mistakes", rows)
	}
}

func TestTheSecondCorrectAnswerMustComeOnALaterLocalDay(t *testing.T) {
	ctx, f := newMistakeFixture(t)

	// 06:30 and 07:30 in Ho Chi Minh City straddle midnight UTC but are one
	// local morning: the mistake stays in review.
	same := f.question(t, ctx, nil)
	f.answer(t, ctx, same, nil, false, at(t, "2026-09-26T20:00:00Z"))
	f.answer(t, ctx, same, nil, true, at(t, "2026-09-26T23:30:00Z"))
	f.answer(t, ctx, same, nil, true, at(t, "2026-09-27T00:30:00Z"))
	if open, _, _ := f.mistake(t, ctx, same); open != "review" {
		t.Fatalf("two correct answers one local morning: status %q, want review", open)
	}

	// 23:30 and 00:30 local are an hour apart but on two days: it graduates.
	next := f.question(t, ctx, nil)
	f.answer(t, ctx, next, nil, false, at(t, "2026-09-27T10:00:00Z"))
	f.answer(t, ctx, next, nil, true, at(t, "2026-09-27T16:30:00Z"))
	f.answer(t, ctx, next, nil, true, at(t, "2026-09-27T17:30:00Z"))
	if open, _, rows := f.mistake(t, ctx, next); open != "" || rows != 1 {
		t.Fatalf("correct at 23:30 and 00:30 local: open %q, %d rows; want graduated", open, rows)
	}

	// A wrong answer in between starts the two-day rule over.
	reset := f.question(t, ctx, nil)
	f.answer(t, ctx, reset, nil, false, at(t, "2026-09-20T03:00:00Z"))
	f.answer(t, ctx, reset, nil, true, at(t, "2026-09-20T04:00:00Z"))
	f.answer(t, ctx, reset, nil, false, at(t, "2026-09-22T03:00:00Z"))
	f.answer(t, ctx, reset, nil, true, at(t, "2026-09-22T04:00:00Z"))
	if open, _, _ := f.mistake(t, ctx, reset); open != "review" {
		t.Fatalf("a slip after the first correct answer: status %q, want review again", open)
	}
}

func TestAnOverrideRestoresTheMistakeForAnyQuestion(t *testing.T) {
	ctx, f := newMistakeFixture(t)
	now := time.Now()

	// A plain quiz's wrong answer, overridden as correct, leaves no mistake.
	plain := f.question(t, ctx, nil)
	a := f.answer(t, ctx, plain, nil, false, now)
	if _, _, err := f.store.OverrideAttempt(ctx, f.user, a, true, "", now); err != nil {
		t.Fatal(err)
	}
	if _, _, rows := f.mistake(t, ctx, plain); rows != 0 {
		t.Fatalf("an overridden plain-quiz mistake left %d records", rows)
	}

	// Overriding the graduating answer as wrong reopens the mistake.
	kp, _ := f.knowledgePoint(t, ctx)
	q := f.question(t, ctx, &kp)
	f.answer(t, ctx, q, &kp, false, at(t, "2026-09-20T03:00:00Z"))
	f.answer(t, ctx, q, &kp, true, at(t, "2026-09-21T03:00:00Z"))
	grad := f.answer(t, ctx, q, &kp, true, at(t, "2026-09-23T03:00:00Z"))
	if open, _, _ := f.mistake(t, ctx, q); open != "" {
		t.Fatalf("setup: expected graduation, got %q", open)
	}
	if _, _, err := f.store.OverrideAttempt(ctx, f.user, grad, false, "", at(t, "2026-09-23T04:00:00Z")); err != nil {
		t.Fatal(err)
	}
	if open, n, rows := f.mistake(t, ctx, q); open != "retrying" || rows != 1 || n != 3 {
		t.Fatalf("after overriding the graduating answer: %q, %d entries, %d rows; want retrying, 3, 1", open, n, rows)
	}
}

// The expand migration keeps the old three-column index, so the pre-change
// INSERT still finds its arbiter while old code runs on the new schema.
func TestOldCodeStillWritesOnTheExpandedSchema(t *testing.T) {
	ctx, f := newMistakeFixture(t)
	kp, _ := f.knowledgePoint(t, ctx)
	q := f.question(t, ctx, &kp)
	const oldSQL = `
		INSERT INTO error_records (user_id, question_id, kp_id, retry_history, status)
		VALUES ($1, $2, $3, '[{"at":"2026-01-01T00:00:00Z"}]'::jsonb, 'active')
		ON CONFLICT (user_id, question_id, kp_id) WHERE status <> 'graduated'
		DO UPDATE SET retry_history = error_records.retry_history || EXCLUDED.retry_history, status = 'retrying'`
	for i := 0; i < 2; i++ {
		if _, err := f.pool.Exec(ctx, oldSQL, f.user, q, kp); err != nil {
			t.Fatalf("the old INSERT on the expanded schema: %v", err)
		}
	}
	if open, n, rows := f.mistake(t, ctx, q); open != "retrying" || n != 2 || rows != 1 {
		t.Fatalf("old code's two wrong answers: %q, %d, %d", open, n, rows)
	}
}

// The expand migration merges duplicate open records (possible under the old
// three-column index: one per knowledge point) before building the new index.
func TestTheExpandMigrationMergesDuplicateOpenMistakes(t *testing.T) {
	ctx, f := newMistakeFixture(t)
	kp, _ := f.knowledgePoint(t, ctx)
	q := f.question(t, ctx, nil)

	raw, err := os.ReadFile("../../../migrations/1789780000_practice_expand.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	merge, _, ok := strings.Cut(string(raw), "-- 2. The new arbiter")
	if !ok {
		t.Fatal("the migration's merge step is no longer marked")
	}

	tx, err := f.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	// Back to the old schema's rule, inside this transaction only.
	if _, err := tx.Exec(ctx, `DROP INDEX error_records_open_q_unique`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO error_records (user_id, question_id, kp_id, retry_history, status, created_at, updated_at) VALUES
		 ($1, $2, NULL, '[{"attempt_id":"a","at":"2026-09-01T00:00:00Z","is_correct":false}]', 'active',
		  '2026-09-01', '2026-09-01'),
		 ($1, $2, $3,   '[{"attempt_id":"b","at":"2026-09-02T00:00:00Z","is_correct":false},
		                  {"attempt_id":"c","at":"2026-09-03T00:00:00Z","is_correct":true}]', 'review',
		  '2026-09-02', '2026-09-03')`, f.user, q, kp); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, merge); err != nil {
		t.Fatalf("merge step: %v", err)
	}
	var (
		n      int
		status string
		ids    string
	)
	if err := tx.QueryRow(ctx, `
		SELECT count(*) OVER (), status,
		       (SELECT string_agg(e->>'attempt_id', ',') FROM jsonb_array_elements(retry_history) e)
		  FROM error_records WHERE user_id = $1 AND question_id = $2`, f.user, q).Scan(&n, &status, &ids); err != nil {
		t.Fatal(err)
	}
	if n != 1 || status != "review" || ids != "a,b,c" {
		t.Fatalf("merged: %d rows, status %q, history %q; want 1, review (the latest state), a,b,c", n, status, ids)
	}
}

func TestThePracticeQueueOrderAndCap(t *testing.T) {
	ctx, f := newMistakeFixture(t)
	now := time.Now()

	var active []uuid.UUID
	for i := 0; i < 3; i++ {
		q := f.question(t, ctx, nil)
		f.answer(t, ctx, q, nil, false, now)
		active = append(active, q)
	}
	earlier := f.question(t, ctx, nil)
	f.answer(t, ctx, earlier, nil, false, now.Add(-72*time.Hour))
	f.answer(t, ctx, earlier, nil, true, now.Add(-48*time.Hour))
	today := f.question(t, ctx, nil)
	f.answer(t, ctx, today, nil, false, now)
	f.answer(t, ctx, today, nil, true, now)

	queue, err := f.store.ListMistakes(ctx, f.user, quiz.PracticeFilter{Now: now}, quiz.PracticeLimit)
	if err != nil {
		t.Fatal(err)
	}
	var got []uuid.UUID
	for _, it := range queue.Items {
		got = append(got, it.Question.ID)
	}
	want := append(append([]uuid.UUID{}, active...), earlier)
	if len(got) != len(want) || queue.Remaining != 4 {
		t.Fatalf("queue = %v (remaining %d), want %v (remaining 4): a review answered right today is not practisable today", got, queue.Remaining, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("queue order = %v, want %v: still-wrong mistakes oldest first, then reviews", got, want)
		}
	}

	for i := 0; i < 20; i++ {
		f.answer(t, ctx, f.question(t, ctx, nil), nil, false, now)
	}
	queue, err = f.store.ListMistakes(ctx, f.user, quiz.PracticeFilter{Now: now}, quiz.PracticeLimit)
	if err != nil {
		t.Fatal(err)
	}
	if len(queue.Items) != quiz.PracticeLimit || queue.Remaining != 24 {
		t.Fatalf("capped queue: %d items, %d remaining; want 20 and 24", len(queue.Items), queue.Remaining)
	}

	// The filters: another knowledge base, and a path, narrow the queue.
	other, _ := pg.NewKnowledgeStore(f.pool).CreateKB(ctx, f.user, "Other")
	queue, _ = f.store.ListMistakes(ctx, f.user, quiz.PracticeFilter{Now: now, KBID: &other.ID}, quiz.PracticeLimit)
	if queue.Remaining != 0 {
		t.Fatalf("another knowledge base's queue holds %d", queue.Remaining)
	}
	kp, path := f.knowledgePoint(t, ctx)
	onPath := f.question(t, ctx, &kp)
	f.answer(t, ctx, onPath, &kp, false, now)
	queue, _ = f.store.ListMistakes(ctx, f.user, quiz.PracticeFilter{Now: now, PathID: &path}, quiz.PracticeLimit)
	if queue.Remaining != 1 || len(queue.Items) != 1 || queue.Items[0].Question.ID != onPath {
		t.Fatalf("the path's queue = %+v", queue)
	}
}
