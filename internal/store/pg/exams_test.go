package pg_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/capabilities/exam"
	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// exams_test.go — learning-depth phase 3: the written type and its rubric,
// partial credit at the 0.7 bar, and the exam tables' ownership and
// idempotence.

var essayRubric = []quiz.Criterion{{Criterion: "Names the reserve", Points: 3}, {Criterion: "Explains why", Points: 2}}

func essay(user, kb uuid.UUID) quiz.Question {
	return quiz.Question{UserID: user, KBID: kb, Prompt: "Explain reserve requirements.",
		Type: quiz.TypeWritten, Answer: "Banks hold a share of deposits.", Difficulty: quiz.DifficultyMedium,
		Rubric: essayRubric}
}

func TestAWrittenQuestionKeepsItsRubric(t *testing.T) {
	ctx, f := newMistakeFixture(t)
	qs, err := f.store.InsertQuestions(ctx, []quiz.Question{essay(f.user, f.kb)})
	if err != nil {
		t.Fatal(err)
	}
	got, err := f.store.GetQuestion(ctx, f.user, qs[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Rubric) != 2 || got.Rubric[0].Points != 3 {
		t.Fatalf("rubric = %+v", got.Rubric)
	}
	if _, shown := got.View(false)["rubric"]; shown {
		t.Fatal("the rubric is part of the answer key and was shown before an attempt")
	}
	if _, shown := got.View(true)["rubric"]; !shown {
		t.Fatal("the rubric is missing once revealed")
	}
	bank, err := f.store.ListQuestions(ctx, f.user, quiz.Filter{Type: quiz.TypeWritten})
	if err != nil || len(bank) != 1 || len(bank[0].Question.Rubric) != 2 {
		t.Fatalf("bank filtered to written: %+v %v", bank, err)
	}
}

func TestTheSchemaHoldsTheRubricToTheWrittenType(t *testing.T) {
	ctx, f := newMistakeFixture(t)
	bare := essay(f.user, f.kb)
	bare.Rubric = nil
	if _, err := f.store.InsertQuestions(ctx, []quiz.Question{bare}); err == nil {
		t.Fatal("a written question without a rubric was stored")
	}
	short := essay(f.user, f.kb)
	short.Type = quiz.TypeShort
	if _, err := f.store.InsertQuestions(ctx, []quiz.Question{short}); err == nil {
		t.Fatal("a short question with a rubric was stored")
	}
}

func score(v float64) *float64 { return &v }

func TestAnEssayBelowTheBarOpensAMistake(t *testing.T) {
	ctx, f := newMistakeFixture(t)
	qs, err := f.store.InsertQuestions(ctx, []quiz.Question{essay(f.user, f.kb), essay(f.user, f.kb)})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	weak, strong := qs[0].ID, qs[1].ID
	if _, _, err := f.store.RecordAttempt(ctx, quiz.AttemptWrite{UserID: f.user, QuestionID: weak,
		UserAnswer: "a", IsCorrect: false, Score: score(0.6), ErrorType: "concept", Rating: "again", Now: now}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := f.store.RecordAttempt(ctx, quiz.AttemptWrite{UserID: f.user, QuestionID: strong,
		UserAnswer: "a", IsCorrect: true, Score: score(0.7), Rating: "good", Now: now}); err != nil {
		t.Fatal(err)
	}
	queue, err := f.store.ListMistakes(ctx, f.user, quiz.PracticeFilter{Now: now}, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(queue.Items) != 1 || queue.Items[0].Question.ID != weak {
		t.Fatalf("practice queue = %+v, want only the 0.6 essay", queue.Items)
	}
	if queue.Items[0].Question.Type != quiz.TypeWritten || len(queue.Items[0].Question.Rubric) != 2 {
		t.Fatal("practice serves the written question without its rubric")
	}

	// The bar is enforced by the schema, not only by Go.
	_, _, err = f.store.RecordAttempt(ctx, quiz.AttemptWrite{UserID: f.user, QuestionID: weak,
		UserAnswer: "a", IsCorrect: true, Score: score(0.6), Rating: "good", Now: now})
	if err == nil {
		t.Fatal("a 0.6 score marked correct was stored")
	}
}

func TestOverridingAnEssayDropsItsScore(t *testing.T) {
	ctx, f := newMistakeFixture(t)
	qs, err := f.store.InsertQuestions(ctx, []quiz.Question{essay(f.user, f.kb)})
	if err != nil {
		t.Fatal(err)
	}
	att, _, err := f.store.RecordAttempt(ctx, quiz.AttemptWrite{UserID: f.user, QuestionID: qs[0].ID,
		UserAnswer: "a", IsCorrect: false, Score: score(0.4), ErrorType: "concept", Rating: "again", Now: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	over, _, err := f.store.OverrideAttempt(ctx, f.user, att.ID, true, "disputed", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if !over.IsCorrect || over.Score != nil {
		t.Fatalf("override: correct %v score %v", over.IsCorrect, over.Score)
	}
}

type examFixture struct {
	pool  *pgxpool.Pool
	store *pg.ExamStore
	user  uuid.UUID
	kb    uuid.UUID
}

func newExamFixture(t *testing.T) (context.Context, *examFixture) {
	t.Helper()
	ctx := context.Background()
	pool := testutil.TestDB(t)
	f := &examFixture{pool: pool, store: pg.NewExamStore(pool), user: testutil.NewUser(t, pool)}
	kb, err := pg.NewKnowledgeStore(pool).CreateKB(ctx, f.user, "Exam KB")
	if err != nil {
		t.Fatal(err)
	}
	f.kb = kb.ID
	return ctx, f
}

func (f *examFixture) template(t *testing.T, ctx context.Context, user uuid.UUID) *exam.Template {
	t.Helper()
	tmpl, err := f.store.CreateTemplate(ctx, exam.Template{UserID: user, Title: "Midterm", Filename: "m.pdf",
		Kind: exam.KindPDF, SHA256: "0000000000000000000000000000000000000000000000000000000000000000",
		Bytes: 10, PageCount: 3, Status: exam.TemplateQueued})
	if err != nil {
		t.Fatal(err)
	}
	return tmpl
}

func (f *examFixture) exam(t *testing.T, ctx context.Context, tmpl uuid.UUID) *exam.Exam {
	t.Helper()
	e, err := f.store.CreateExam(ctx, exam.Exam{UserID: f.user, TemplateID: &tmpl, KBID: f.kb, Title: "Midterm",
		Status: exam.ExamGenerating, Requested: 2,
		Blueprint: []exam.Item{{Number: "1", Type: quiz.TypeTF, Points: 1}, {Number: "2", Type: quiz.TypeWritten, Points: 5}}})
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func tfQuestion(user, kb uuid.UUID) quiz.Question {
	return quiz.Question{UserID: user, KBID: kb, Prompt: "Reserves are held.", Type: quiz.TypeTF,
		Answer: "true", Difficulty: quiz.DifficultyEasy}
}

func TestExtractionBatchesAreReplacedNotAppended(t *testing.T) {
	ctx, f := newExamFixture(t)
	tmpl := f.template(t, ctx, f.user)
	for _, stem := range []string{"first try", "retry"} {
		if err := f.store.SaveBatch(ctx, f.user, tmpl.ID, 0, []exam.Item{{Number: "1", StemMD: stem}}); err != nil {
			t.Fatal(err)
		}
	}
	batches, err := f.store.Batches(ctx, f.user, tmpl.ID)
	if err != nil || len(batches[0]) != 1 || batches[0][0].StemMD != "retry" {
		t.Fatalf("batches = %+v %v", batches, err)
	}
	// Another user's template is refused by the composite key.
	other := testutil.NewUser(t, f.pool)
	if err := f.store.SaveBatch(ctx, other, tmpl.ID, 1, nil); err == nil {
		t.Fatal("a batch was stored against another user's template")
	}
	if err := f.store.FinishExtraction(ctx, f.user, tmpl.ID, batches[0], []string{"w"}, 1); err != nil {
		t.Fatal(err)
	}
	got, _ := f.store.GetTemplate(ctx, f.user, tmpl.ID)
	if got.Status != exam.TemplateReview || len(got.Items) != 1 || got.Warnings[0] != "w" {
		t.Fatalf("after extraction: %+v", got)
	}
	if left, _ := f.store.Batches(ctx, f.user, tmpl.ID); len(left) != 0 {
		t.Fatal("the batches outlived the extraction")
	}
}

func TestAGeneratedItemIsStoredOnceAndCounted(t *testing.T) {
	ctx, f := newExamFixture(t)
	e := f.exam(t, ctx, f.template(t, ctx, f.user).ID)
	for range 2 {
		if err := f.store.AddGeneratedItem(ctx, e.ID, 0, tfQuestion(f.user, f.kb), 1, "1"); err != nil {
			t.Fatal(err)
		}
		if err := f.store.AddDropped(ctx, f.user, e.ID, exam.Dropped{Ord: 1, Number: "2", Reason: "r"}); err != nil {
			t.Fatal(err)
		}
	}
	for ord, want := range []bool{true, true} {
		if done, err := f.store.HasUnit(ctx, f.user, e.ID, ord); err != nil || done != want {
			t.Fatalf("HasUnit(%d) = %v %v", ord, done, err)
		}
	}
	if done, _ := f.store.HasUnit(ctx, f.user, e.ID, 2); done {
		t.Fatal("an item never generated reads as done")
	}
	got, _ := f.store.GetExam(ctx, f.user, e.ID)
	var questions int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM questions WHERE user_id = $1`, f.user).Scan(&questions)
	if got.Generated != 1 || len(got.Dropped) != 1 || questions != 1 {
		t.Fatalf("generated %d, dropped %d, questions %d; want 1, 1, 1", got.Generated, len(got.Dropped), questions)
	}
	if err := f.store.FinishGeneration(ctx, f.user, e.ID, ""); err != nil {
		t.Fatal(err)
	}
	if got, _ := f.store.GetExam(ctx, f.user, e.ID); got.Status != exam.ExamReady {
		t.Fatalf("status %s, want ready", got.Status)
	}
}

func TestAnswersAreSavedOnlyToTheExamsOwnItems(t *testing.T) {
	ctx, f := newExamFixture(t)
	tmpl := f.template(t, ctx, f.user)
	e := f.exam(t, ctx, tmpl.ID)
	other := f.exam(t, ctx, tmpl.ID)
	for _, id := range []uuid.UUID{e.ID, other.ID} {
		if err := f.store.AddGeneratedItem(ctx, id, 0, tfQuestion(f.user, f.kb), 1, "1"); err != nil {
			t.Fatal(err)
		}
		if err := f.store.FinishGeneration(ctx, f.user, id, ""); err != nil {
			t.Fatal(err)
		}
	}
	mine, _ := f.store.Items(ctx, f.user, e.ID)
	theirs, _ := f.store.Items(ctx, f.user, other.ID)
	now := time.Now().UTC()

	if err := f.store.SaveAnswers(ctx, f.user, e.ID, []exam.Answer{{ItemID: mine[0].ID, Text: "true"}}, now); !errors.Is(err, exam.ErrConflict) {
		t.Fatalf("an answer before the start: %v, want ErrConflict", err)
	}
	if ok, err := f.store.Start(ctx, f.user, e.ID, nil, now); !ok || err != nil {
		t.Fatalf("start: %v %v", ok, err)
	}
	// Another exam's item, even the same user's, is not this exam's.
	err := f.store.SaveAnswers(ctx, f.user, e.ID, []exam.Answer{{ItemID: mine[0].ID, Text: "true"}, {ItemID: theirs[0].ID, Text: "x"}}, now)
	if !errors.Is(err, exam.ErrNotFound) {
		t.Fatalf("another exam's item: %v, want ErrNotFound", err)
	}
	if got, _ := f.store.Items(ctx, f.user, e.ID); got[0].Answer != "" {
		t.Fatal("a refused save stored part of its answers")
	}
	// Another user names nothing.
	if err := f.store.SaveAnswers(ctx, testutil.NewUser(t, f.pool), e.ID, nil, now); !errors.Is(err, exam.ErrNotFound) {
		t.Fatalf("another user's save: %v", err)
	}
	if err := f.store.SaveAnswers(ctx, f.user, e.ID, []exam.Answer{{ItemID: mine[0].ID, Text: "true"}}, now); err != nil {
		t.Fatal(err)
	}
	if got, _ := f.store.Items(ctx, f.user, e.ID); got[0].Answer != "true" {
		t.Fatalf("answer = %q", got[0].Answer)
	}
}

func TestDeletingATemplateKeepsItsExams(t *testing.T) {
	ctx, f := newExamFixture(t)
	tmpl := f.template(t, ctx, f.user)
	e := f.exam(t, ctx, tmpl.ID)
	if _, err := f.store.DeleteTemplate(ctx, f.user, tmpl.ID); err != nil {
		t.Fatal(err)
	}
	got, err := f.store.GetExam(ctx, f.user, e.ID)
	if err != nil || got.TemplateID != nil || got.UserID != f.user {
		t.Fatalf("exam after its template was deleted: %+v %v", got, err)
	}
}
