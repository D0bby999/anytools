package loop

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func score(n int) *int { return &n }

func scored(c, q, r, tr int) WeeklyReview {
	return WeeklyReview{WeekNo: 3, Completion: score(c), Quality: score(q), Retention: score(r), Transfer: score(tr),
		OneVariableChange: "Study at 7am instead of 10pm", Errors: []ReviewError{}}
}

func goodError() ReviewError {
	return ReviewError{Evidence: "Missed 4 of 10 tones", Cause: "Never heard them spoken",
		Confidence: ConfidenceMedium, NextTest: "Listen first, then read", StopCondition: "Two weeks with no change"}
}

func TestWritebackProblems(t *testing.T) {
	cases := []struct {
		name     string
		review   WeeklyReview
		accepted int
		want     []string // substrings; empty means writeback allowed
	}{
		{"ready", scored(2, 1, 1, 1), 1, nil},
		{"no evidence", scored(2, 1, 1, 1), 0, []string{"at least one piece of evidence"}},
		{"unscored", WeeklyReview{OneVariableChange: "x"}, 1,
			[]string{"Score completion", "Score quality", "Score retention", "Score transfer"}},
		{"no change named", func() WeeklyReview { r := scored(2, 2, 2, 2); r.OneVariableChange = " "; return r }(), 1,
			[]string{"one thing you will change"}},
		{"two changes", func() WeeklyReview { r := scored(2, 2, 2, 2); r.OneVariableChange = "a\nb"; return r }(), 1,
			[]string{"one thing at a time"}},
		{"zero without diagnosis", scored(0, 1, 1, 1), 1, []string{"scored 0 needs"}},
		{"zero with diagnosis", func() WeeklyReview { r := scored(0, 1, 1, 1); r.Errors = []ReviewError{goodError()}; return r }(), 1, nil},
		{"incomplete mistake", func() WeeklyReview {
			r := scored(1, 1, 1, 1)
			e := goodError()
			e.StopCondition, e.Confidence = "", "sure"
			r.Errors = []ReviewError{e}
			return r
		}(), 1, []string{"Mistake 1 is missing: confidence, stop condition"}},
		{"already written back", func() WeeklyReview { r := scored(2, 2, 2, 2); r.WritebackDone = true; return r }(), 1,
			[]string{"already been written back"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := WritebackProblems(tc.review, tc.accepted)
			if len(tc.want) == 0 {
				if len(got) != 0 {
					t.Fatalf("problems = %v, want none", got)
				}
				return
			}
			all := strings.Join(got, " | ")
			for _, w := range tc.want {
				if !strings.Contains(all, w) {
					t.Errorf("%q not in %q", w, all)
				}
			}
		})
	}
}

func TestPlanWritebackTurnsMistakesIntoHypotheses(t *testing.T) {
	r := scored(0, 1, 1, 1)
	r.Errors = []ReviewError{goodError()}
	hyps, err := PlanWriteback(r, 2)
	if err != nil {
		t.Fatalf("PlanWriteback: %v", err)
	}
	if len(hyps) != 2 {
		t.Fatalf("hypotheses = %+v, want one per mistake plus the change", hyps)
	}
	if h := hyps[0]; h.Source != HypothesisFromError || h.StopCondition == "" || h.Week != 3 {
		t.Errorf("mistake hypothesis = %+v", h)
	}
	if h := hyps[1]; h.Source != HypothesisFromChange || h.Claim != r.OneVariableChange {
		t.Errorf("change hypothesis = %+v", h)
	}

	_, err = PlanWriteback(scored(1, 1, 1, 1), 0)
	var nr *NotReadyError
	if !errors.As(err, &nr) {
		t.Fatalf("no evidence: err = %v, want NotReadyError", err)
	}
}

func TestReviewPatchRejectsOutOfRangeScores(t *testing.T) {
	for _, n := range []int{-1, 3} {
		if err := (ReviewPatch{Quality: score(n)}).Validate(); !errors.Is(err, ErrInvalid) {
			t.Errorf("quality %d: err = %v, want ErrInvalid", n, err)
		}
	}
	if err := (ReviewPatch{Quality: score(2)}).Validate(); err != nil {
		t.Errorf("quality 2: %v", err)
	}
}

func TestWeekOf(t *testing.T) {
	start := time.Date(2026, 9, 1, 9, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		at   time.Time
		want int
	}{
		{start.Add(-time.Hour), 1},
		{start, 1},
		{start.Add(7*24*time.Hour - time.Second), 1},
		{start.Add(7 * 24 * time.Hour), 2},
		{start.Add(89 * 24 * time.Hour), 13},
		{start.Add(400 * 24 * time.Hour), 13},
	} {
		if got := WeekOf(start, tc.at); got != tc.want {
			t.Errorf("WeekOf(%v) = %d, want %d", tc.at.Sub(start), got, tc.want)
		}
	}
}

func TestInterruptionShrinksRatherThanDrops(t *testing.T) {
	st := LearningState{NextTask: "Read a full article", NextTaskMinimum: "Read one headline"}
	// Phase 13: an interruption now needs its fact and its 24-hour output; the
	// minimum rule is unchanged.
	lines := InterruptRequest{Fact: "Flu", Within24h: "Read one headline aloud"}
	next, min, entry, err := PlanInterruption(st, lines, time.Now())
	if err != nil || next != "Read one headline" || min != next || entry.PriorTask != "Read a full article" {
		t.Fatalf("PlanInterruption = %q %q %+v %v", next, min, entry, err)
	}
	if _, _, _, err := PlanInterruption(LearningState{NextTask: "x"}, lines, time.Now()); !errors.Is(err, ErrInvalid) {
		t.Fatalf("no minimum anywhere: err = %v, want ErrInvalid", err)
	}
	withMin := lines
	withMin.Minimum = "one line"
	next, _, _, err = PlanInterruption(LearningState{NextTask: "x"}, withMin, time.Now())
	if err != nil || next != "one line" {
		t.Fatalf("minimum supplied in the request: %q %v", next, err)
	}
}
