package exam_test

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/capabilities/exam"
	"github.com/D0bby999/anytools/internal/capabilities/quiz"
)

// generatedExam is a ready mock exam of mixedItems.
func (h *harness) generatedExam(t *testing.T) *exam.Exam {
	t.Helper()
	h.model.reply = func(kind, user string) (string, error) { return reply(h.draftFor(user)) }
	tmpl := h.readyTemplate(t, mixedItems())
	e, err := h.svc.Create(h.ctx, h.user, exam.CreateRequest{TemplateID: tmpl.ID, KBID: h.kb})
	if err != nil {
		t.Fatal(err)
	}
	if err := h.run(t, *e.JobID, h.svc.HandleGenerate); err != nil {
		t.Fatal(err)
	}
	return e
}

// markingModel marks cloze and short answers right, and awards the written
// answer 3 of its 5 points (0.6, below the bar).
func markingModel(kind, _ string) (string, error) {
	switch kind {
	case callJudge:
		return `{"correct": true, "reason": "That is the reserve.", "error_type": ""}`, nil
	case callRubric:
		return `{"criteria": [{"number": 1, "awarded": 2, "comment": "half there"}, {"number": 2, "awarded": 1}],
		         "reason": "The mechanism is missing.", "error_type": "concept"}`, nil
	}
	return "", errors.New("unexpected call " + kind)
}

func (h *harness) answerAll(t *testing.T, id exam.Exam) {
	t.Helper()
	v, err := h.svc.View(h.ctx, h.user, id.ID)
	if err != nil {
		t.Fatal(err)
	}
	// mcq right, tf wrong, cloze and short to the judge, written to its rubric.
	texts := []string{"A", "false", "reserves", "reserves", "Banks hold reserves because the law says so."}
	var answers []exam.Answer
	for i, it := range v.Items {
		answers = append(answers, exam.Answer{ItemID: it.ID, Text: texts[i]})
	}
	if err := h.svc.SaveAnswers(h.ctx, h.user, id.ID, answers); err != nil {
		t.Fatal(err)
	}
}

func TestSubmittingMarksEveryTypeAndOpensMistakesBelowTheBar(t *testing.T) {
	h := newHarness(t)
	e := h.generatedExam(t)
	generated := len(h.model.calls)
	h.model.reply = markingModel

	if err := h.svc.SaveAnswers(h.ctx, h.user, e.ID, nil); !errors.Is(err, exam.ErrConflict) {
		t.Fatalf("answering before the start: %v", err)
	}
	limit := 1
	started, err := h.svc.Start(h.ctx, h.user, e.ID, &limit)
	if err != nil {
		t.Fatal(err)
	}
	if len(started.Items) != 5 || started.DeadlineAt == nil || started.Items[0].Question["revealed"] != false {
		t.Fatalf("a started exam: %d items, deadline %v", len(started.Items), started.DeadlineAt)
	}
	if _, ok := started.Items[0].Question["answer"]; ok {
		t.Fatal("the answer key reached an exam in progress")
	}
	h.answerAll(t, *e)

	// Two minutes on a one-minute limit: accepted, and flagged late.
	h.clock = h.clock.Add(2 * time.Minute)
	v, err := h.svc.Submit(h.ctx, h.user, e.ID)
	if err != nil {
		t.Fatal(err)
	}
	if v.Status != exam.ExamSubmitted || !v.Late || v.TakenSeconds == nil || *v.TakenSeconds != 120 {
		t.Fatalf("submitted: status %s, late %v, taken %v", v.Status, v.Late, v.TakenSeconds)
	}
	// 2 (mcq) + 0 (tf) + 1 (cloze) + 2 (short) + 0.6 × 5 (written) of 11.
	if *v.Score != 8 || *v.MaxScore != 11 {
		t.Fatalf("score %v of %v, want 8 of 11", *v.Score, *v.MaxScore)
	}
	// Objective answers were marked in Go; only the judge and the rubric
	// called the model.
	if n := len(h.model.calls) - generated; n != 3 || h.model.count(callJudge) != 2 || h.model.count(callRubric) != 1 {
		t.Fatalf("%d marking calls (judge %d, rubric %d), want 3", n, h.model.count(callJudge), h.model.count(callRubric))
	}
	written := v.Items[4]
	if *written.Score != 0.6 || *written.Awarded != 3 || *written.Correct {
		t.Fatalf("the essay: score %v awarded %v correct %v", *written.Score, *written.Awarded, *written.Correct)
	}
	var j quiz.Judgement
	if err := json.Unmarshal(written.Judge, &j); err != nil || j.Mode != quiz.JudgeModeRubric || len(j.Criteria) != 2 {
		t.Fatalf("the essay's judgement: %+v %v", j, err)
	}
	if written.Question["revealed"] != true || written.Question["rubric"] == nil {
		t.Fatal("the marked essay does not show its rubric")
	}

	// The wrong true/false and the 0.6 essay are mistakes Practice serves.
	queue, err := h.quiz.ListMistakes(h.ctx, h.user, quiz.PracticeFilter{Now: h.clock}, 20)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, it := range queue.Items {
		got[it.Question.Type] = true
	}
	if len(queue.Items) != 2 || !got[quiz.TypeTF] || !got[quiz.TypeWritten] {
		t.Fatalf("practice queue = %+v, want the tf and the written item", got)
	}

	// Submitting again changes nothing and calls nothing.
	before := len(h.model.calls)
	again, err := h.svc.Submit(h.ctx, h.user, e.ID)
	if err != nil || *again.Score != 8 || len(h.model.calls) != before {
		t.Fatalf("a second submit: %v, %d new calls", err, len(h.model.calls)-before)
	}
	if err := h.svc.SaveAnswers(h.ctx, h.user, e.ID, nil); !errors.Is(err, exam.ErrConflict) {
		t.Fatalf("answering after the submit: %v", err)
	}
}

func TestASubmitThatStopsPartWayMarksOnlyTheRestNextTime(t *testing.T) {
	h := newHarness(t)
	e := h.generatedExam(t)
	rubricDown := true
	h.model.reply = func(kind, user string) (string, error) {
		if kind == callRubric && rubricDown {
			return "", errors.New("provider timed out")
		}
		return markingModel(kind, user)
	}
	if _, err := h.svc.Start(h.ctx, h.user, e.ID, nil); err != nil {
		t.Fatal(err)
	}
	h.answerAll(t, *e)
	if _, err := h.svc.Submit(h.ctx, h.user, e.ID); !errors.Is(err, exam.ErrMarkingIncomplete) {
		t.Fatalf("a failed rubric call: %v", err)
	}
	v, _ := h.svc.View(h.ctx, h.user, e.ID)
	if v.Marked != 4 || v.Status != exam.ExamInProgress || v.SubmittedAt == nil {
		t.Fatalf("after a partial submit: %d marked, %s, submitted at %v", v.Marked, v.Status, v.SubmittedAt)
	}
	// The answers are locked once submitted, even before marking finishes.
	if err := h.svc.SaveAnswers(h.ctx, h.user, e.ID, nil); !errors.Is(err, exam.ErrConflict) {
		t.Fatalf("answering after a partial submit: %v", err)
	}
	judged := h.model.count(callJudge)
	rubricDown = false
	h.clock = h.clock.Add(time.Hour)
	v, err := h.svc.Submit(h.ctx, h.user, e.ID)
	if err != nil {
		t.Fatal(err)
	}
	if v.Status != exam.ExamSubmitted || h.model.count(callJudge) != judged || v.Late {
		t.Fatalf("the second submit re-marked answers (judge %d → %d) or moved the clock (late %v)",
			judged, h.model.count(callJudge), v.Late)
	}
	if *v.TakenSeconds != 0 {
		t.Fatalf("taken %d s: the time taken is the first submit's", *v.TakenSeconds)
	}
}
