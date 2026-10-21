package quiz

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
)

// math_judge_test.go: a maths answer is marked by value in Go, with no model
// call (plans/261020-1535-beyond-english-learning-areas, phase 2).

func mathQuestion(user uuid.UUID, prompt, answer string) Question {
	return Question{ID: uuid.New(), UserID: user, Type: TypeShort, Prompt: prompt, Answer: answer}
}

func TestAMathsAnswerIsMarkedWithoutTheModel(t *testing.T) {
	user := uuid.New()
	cases := []struct {
		name, prompt, recorded, answer, attribution string
		correct, almost                             bool
		rating                                      string
		why                                         string
	}{
		{"another form", "Write 2(x+1) another way.", "2(x+1)", "2x + 2", "", true, false, learning.RatingGood, ""},
		{"wrong", "Write 2(x+1) another way.", "2(x+1)", "2x + 1", "", false, false, learning.RatingAgain, ""},
		{"not the form asked", "Factorise x^2 - 1.", "(x-1)(x+1)", "x^2 - 1", "confident", true, true, learning.RatingHard, "form"},
		{"a number", "How many?", "42", "42.0", "confident", true, false, learning.RatingEasy, ""},
		{"another unit", "How far, in metres?", "5 m", "500 cm", "", true, false, learning.RatingGood, ""},
		{"not the unit asked", "Convert 5 m to cm.", "500 cm", "5 m", "confident", true, true, learning.RatingHard, "unit"},
		{"no unit", "How far?", "5 m", "5", "confident", true, true, learning.RatingHard, "no_unit"},
		{"an interval", "Solve 2 < x + 1 <= 6.", "(1, 5]", "1 < x <= 5", "", true, false, learning.RatingGood, ""},
		{"the wrong bracket", "Solve 2 < x + 1 <= 6.", "(1, 5]", "(1, 5)", "", false, false, learning.RatingAgain, ""},
		{"a matrix", "Transpose [[1, 2], [3, 4]].", "[[1, 3], [2, 4]]", "((1,3),(2,4))", "", true, false, learning.RatingGood, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := &scripted{}
			st := &recordingStore{q: mathQuestion(user, c.prompt, c.recorded)}
			svc := NewService(Config{Store: st, Providers: resolver{p}, Now: time.Now})
			res, err := svc.Attempt(context.Background(), user, st.q.ID, AttemptRequest{UserAnswer: c.answer, SelfAttribution: c.attribution, AskIfUnreadable: true})
			if err != nil {
				t.Fatal(err)
			}
			if len(p.systems) != 0 {
				t.Fatalf("%d model calls for a maths answer the checker can read", len(p.systems))
			}
			w := st.written[0]
			var j Judgement
			_ = json.Unmarshal(w.Judge, &j)
			if w.IsCorrect != c.correct || j.Mode != JudgeModeMath || j.Almost != c.almost || j.AlmostWhy != c.why || w.Rating != c.rating {
				t.Fatalf("correct %v, judge %+v, rating %s", w.IsCorrect, j, w.Rating)
			}
			if res.Answer != c.recorded {
				t.Fatalf("the recorded answer is returned after the attempt: %q", res.Answer)
			}
		})
	}
}

func TestAnUnreadableMathsAnswerIsNotMarked(t *testing.T) {
	user := uuid.New()
	p := &scripted{replies: []string{`{"correct": false, "reason": "Unbalanced.", "error_type": "careless"}`}}
	st := &recordingStore{q: mathQuestion(user, "Expand.", "2x+2")}
	svc := NewService(Config{Store: st, Providers: resolver{p}, Now: time.Now})

	// The card asks first: nothing is recorded, no model is called.
	_, err := svc.Attempt(context.Background(), user, st.q.ID, AttemptRequest{UserAnswer: "2(x+1", AskIfUnreadable: true})
	if !errors.Is(err, ErrUnreadableMath) || len(st.written) != 0 || len(p.systems) != 0 {
		t.Fatalf("err %v, %d written, %d calls", err, len(st.written), len(p.systems))
	}
	// "Send as text", and an exam's marking: the model marks it, as before.
	if _, err := svc.Attempt(context.Background(), user, st.q.ID, AttemptRequest{UserAnswer: "2(x+1"}); err != nil {
		t.Fatal(err)
	}
	if len(p.systems) != 1 || len(st.written) != 1 {
		t.Fatalf("%d calls, %d written", len(p.systems), len(st.written))
	}
}

func TestWordsStillGoToTheModel(t *testing.T) {
	user := uuid.New()
	p := &scripted{replies: []string{`{"correct": true, "reason": "Same thing.", "error_type": "none"}`}}
	st := &recordingStore{q: mathQuestion(user, "What do plants make?", "glucose")}
	svc := NewService(Config{Store: st, Providers: resolver{p}, Now: time.Now})
	if _, err := svc.Attempt(context.Background(), user, st.q.ID, AttemptRequest{UserAnswer: "sugar", AskIfUnreadable: true}); err != nil {
		t.Fatal(err)
	}
	if len(p.systems) != 1 {
		t.Fatalf("%d model calls for a word answer, want 1", len(p.systems))
	}
}

func TestTheViewSaysAMathsAnswerIsExpected(t *testing.T) {
	for answer, want := range map[string]bool{"2(x+1)": true, "y = 2x + 1": true, "42": false, "glucose": false} {
		q := Question{Type: TypeShort, Answer: answer}
		if got, _ := q.View(false)["math"].(bool); got != want {
			t.Errorf("%q: math %v, want %v", answer, got, want)
		}
		if _, leaked := q.View(false)["answer"]; leaked {
			t.Fatalf("the answer is in an unrevealed view")
		}
	}
	if (Question{Type: TypeMCQ, Answer: "2x"}).IsMath() {
		t.Error("a multiple-choice question is marked by its label")
	}
}
