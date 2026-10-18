package loop

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func sampleState() LearningState {
	return LearningState{
		ID: uuid.New(), Goal: "Read Vietnamese news", NextTask: "Ten words",
		UpdatedAt: time.Date(2026, 9, 20, 8, 0, 0, 0, time.UTC),
	}
}

func block(t *testing.T, pb map[string]any) string {
	t.Helper()
	raw, err := json.Marshal(pb)
	if err != nil {
		t.Fatal(err)
	}
	return "Here is the update.\n\n```" + PasteBackFence + "\n" + string(raw) + "\n```\n"
}

func validBlock(rev string) map[string]any {
	return map[string]any{
		"revision":    rev,
		"restated":    []string{"Goal: read Vietnamese news", "Next task: ten words"},
		"exercise":    map[string]string{"prompt": "Translate 'báo'", "outcome": "Correct"},
		"unknowns":    []string{},
		"next_task":   "Twenty words",
		"handover_md": "Tones are the weak spot; start with listening.",
	}
}

func TestParsePasteBack(t *testing.T) {
	st := sampleState()
	rev := Revision(st)

	tooMany := validBlock(rev)
	tooMany["restated"] = []string{"1", "2", "3", "4", "5", "6", "7"}
	extra := validBlock(rev)
	extra["remembered"] = "we talked last week"
	noExercise := validBlock(rev)
	noExercise["exercise"] = map[string]string{"prompt": "", "outcome": ""}

	cases := []struct {
		name    string
		text    string
		noBlock bool
		problem string // "" means valid
	}{
		{name: "valid block", text: block(t, validBlock(rev))},
		{name: "bare json", text: func() string { b, _ := json.Marshal(validBlock(rev)); return string(b) }()},
		{name: "prose only", text: "We covered tones last time.", noBlock: true},
		{name: "two blocks", text: block(t, validBlock(rev)) + block(t, validBlock(rev)), problem: "more than one"},
		{name: "seven bullets", text: block(t, tooMany), problem: "at most 6"},
		{name: "invented field", text: block(t, extra), problem: "expected shape"},
		{name: "no exercise", text: block(t, noExercise), problem: "exercise"},
		{name: "broken json", text: "```" + PasteBackFence + "\n{\"revision\": \n```", problem: "expected shape"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pb, problems, err := ParsePasteBack(tc.text)
			if tc.noBlock {
				if err != ErrNoPasteBack {
					t.Fatalf("err = %v, want ErrNoPasteBack", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("err = %v", err)
			}
			all := strings.Join(problems, " | ")
			if tc.problem == "" {
				if len(problems) != 0 || pb == nil {
					t.Fatalf("problems = %v", problems)
				}
				if p := CheckRevision(pb, st); p != nil {
					t.Fatalf("revision check: %v", p)
				}
				return
			}
			if !strings.Contains(all, tc.problem) {
				t.Fatalf("problems %q do not mention %q", all, tc.problem)
			}
		})
	}
}

// TestARevisionNotCopiedFromTheStateIsRefused is the "refuse to invent memory"
// check made mechanical: a block whose revision the model made up, or one
// written before the state changed, never validates.
func TestARevisionNotCopiedFromTheStateIsRefused(t *testing.T) {
	st := sampleState()
	for _, rev := range []string{"abc123def456", Revision(LearningState{ID: st.ID, UpdatedAt: st.UpdatedAt.Add(-time.Hour)})} {
		pb, problems, err := ParsePasteBack(block(t, validBlock(rev)))
		if err != nil || len(problems) != 0 {
			t.Fatalf("structural parse failed: %v %v", problems, err)
		}
		if CheckRevision(pb, st) == nil {
			t.Errorf("revision %q was accepted against %q", rev, Revision(st))
		}
	}
}

func TestRenderStateMarksEmptyFields(t *testing.T) {
	out := RenderState(sampleState(), nil)
	for _, want := range []string{"Goal: Read Vietnamese news", "Real scenario: (empty)", "AI may:\n- (empty)", "Cycle: (none)", "Handover note:\n(empty)"} {
		if !strings.Contains(out, want) {
			t.Errorf("rendered state lacks %q:\n%s", want, out)
		}
	}
}

func TestThreeWayReadsTheDelayedColumn(t *testing.T) {
	v := func(f float64) *float64 { return &f }
	l := Log{
		BaselineNoAI:       map[string]Cell{MetricQuality: {Value: v(1)}, MetricRework: {Value: v(5)}, MetricCost: {Value: v(3)}, MetricCompletion: {Value: v(2)}},
		Assisted:           map[string]Cell{MetricQuality: {Value: v(2)}, MetricRework: {Value: v(2)}, MetricCost: {Value: v(1)}, MetricCompletion: {Value: v(1)}},
		DelayedIndependent: map[string]Cell{MetricQuality: {Value: v(1)}, MetricRework: {Value: v(4)}, MetricCost: {Value: v(3)}, MetricCompletion: {Value: v(2)}},
	}
	want := map[string]string{
		MetricQuality:         ReadingOnlyWithAI, // AI helped; nothing kept
		MetricRework:          ReadingRetained,   // lower is better, 4 < 5
		MetricCost:            ReadingOnlyWithAI,
		MetricCompletion:      ReadingNoGain,
		MetricIndependentPerf: ReadingIncomplete,
		MetricTransfer:        ReadingIncomplete,
	}
	for _, row := range ThreeWay(l) {
		if row.Reading != want[row.Metric] {
			t.Errorf("%s: reading %s, want %s", row.Metric, row.Reading, want[row.Metric])
		}
		if row.CannotProve == "" {
			t.Errorf("%s: no cannot-prove note", row.Metric)
		}
	}
}
