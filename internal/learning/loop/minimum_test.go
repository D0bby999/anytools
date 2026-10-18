package loop

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestMinimumContractLimitsAreInCharacters(t *testing.T) {
	ok := MinimumContract{DownshiftWhen: strings.Repeat("ă", MaxContractLen)} // 2000 bytes, 1000 characters
	if err := (StatePatch{MinimumContract: &ok}).Validate(); err != nil {
		t.Fatalf("1000 characters refused: %v", err)
	}
	for _, c := range []MinimumContract{
		{DownshiftWhen: strings.Repeat("a", MaxContractLen+1)},
		{StillWorthKeeping: strings.Repeat("a", MaxContractLen+1)},
		{AskForHelpWhen: strings.Repeat("a", MaxContractLen+1)},
	} {
		if err := (StatePatch{MinimumContract: &c}).Validate(); !errors.Is(err, ErrInvalid) {
			t.Errorf("over-long answer: err = %v, want ErrInvalid", err)
		}
	}
}

// TestInterruptionRecordsUpsSixLines: fact and the 24-hour output are
// required, the resistance is one of up's five, the review date is a date,
// and "task reduced to" is the minimum the protocol swaps in.
func TestInterruptionRecordsUpsSixLines(t *testing.T) {
	st := LearningState{NextTask: "Read a full article", NextTaskMinimum: "Read one headline"}
	now := time.Date(2026, 10, 16, 3, 0, 0, 0, time.UTC)
	full := InterruptRequest{
		Fact: " Two night shifts in a row ", Resistance: ResistanceEnergy, Within24h: "Say five words aloud",
		NotRepaying: "Tuesday's article", ReviewOn: "2026-10-20",
	}
	_, _, entry, err := PlanInterruption(st, full, now)
	if err != nil {
		t.Fatalf("PlanInterruption: %v", err)
	}
	want := Interruption{
		At: now, Fact: "Two night shifts in a row", Resistance: ResistanceEnergy, ReducedTo: "Read one headline",
		Within24h: "Say five words aloud", NotRepaying: "Tuesday's article", ReviewOn: "2026-10-20",
		PriorTask: "Read a full article",
	}
	if entry != want {
		t.Fatalf("entry = %+v\nwant    %+v", entry, want)
	}

	cases := map[string]func(r *InterruptRequest){
		"no fact":             func(r *InterruptRequest) { r.Fact = "  " },
		"no 24-hour output":   func(r *InterruptRequest) { r.Within24h = "" },
		"unknown resistance":  func(r *InterruptRequest) { r.Resistance = "motivation" },
		"capitalised option":  func(r *InterruptRequest) { r.Resistance = "Time" },
		"review date garbage": func(r *InterruptRequest) { r.ReviewOn = "next week" },
		"long fact":           func(r *InterruptRequest) { r.Fact = strings.Repeat("a", MaxContractLen+1) },
		"long not-repaying":   func(r *InterruptRequest) { r.NotRepaying = strings.Repeat("a", MaxContractLen+1) },
	}
	for name, mutate := range cases {
		req := full
		mutate(&req)
		if _, _, _, err := PlanInterruption(st, req, now); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want ErrInvalid", name, err)
		}
	}
	optional := InterruptRequest{Fact: "Moved house", Within24h: "One word"}
	if _, _, entry, err := PlanInterruption(st, optional, now); err != nil || entry.Resistance != "" || entry.ReviewOn != "" {
		t.Fatalf("resistance, not-repaying and review date are optional: %+v %v", entry, err)
	}
}

// TestAnOldInterruptionStillDecodes: entries written before the six lines
// have only a note, which stays readable and is not rewritten away.
func TestAnOldInterruptionStillDecodes(t *testing.T) {
	var it Interruption
	if err := json.Unmarshal([]byte(`{"at":"2026-09-01T08:00:00Z","note":"Sick","prior_task":"Ten words"}`), &it); err != nil {
		t.Fatal(err)
	}
	if it.Note != "Sick" || it.Fact != "" || it.PriorTask != "Ten words" {
		t.Fatalf("old entry = %+v", it)
	}
	raw, _ := json.Marshal(it)
	if !strings.Contains(string(raw), `"note":"Sick"`) {
		t.Fatalf("re-encoding lost the note: %s", raw)
	}
}

func TestRepeatedResistance(t *testing.T) {
	r := func(names ...string) []Interruption {
		out := make([]Interruption, len(names))
		for i, n := range names {
			out[i] = Interruption{Resistance: n}
		}
		return out
	}
	cases := []struct {
		name   string
		recent []Interruption
		want   string
	}{
		{"three the same", r("time", "time", "time"), "time"},
		{"only the last three count", r("time", "time", "time", "energy"), "time"},
		{"two the same", r("time", "time"), ""},
		{"three with one different", r("time", "energy", "time"), ""},
		{"three that name none", r("", "", ""), ""},
		{"none", nil, ""},
	}
	for _, tc := range cases {
		if got := RepeatedResistance(tc.recent); got != tc.want {
			t.Errorf("%s: %q, want %q", tc.name, got, tc.want)
		}
	}
}

// TestRenderStateKeepsAskForHelpPrivate: resume text — sent with every turn of
// a state-linked chat — carries two of the contract's answers and never the
// third (plan principle 5, AC3).
func TestRenderStateKeepsAskForHelpPrivate(t *testing.T) {
	st := sampleState()
	st.MinimumContract = MinimumContract{
		DownshiftWhen:     "DOWNSHIFT-MARKER-7f3a",
		StillWorthKeeping: "KEEPING-MARKER-7f3a",
		AskForHelpWhen:    "HELP-MARKER-7f3a",
	}
	out := RenderState(st, &Cycle{Phase: PhaseCalibrate})
	for _, want := range []string{"DOWNSHIFT-MARKER-7f3a", "KEEPING-MARKER-7f3a"} {
		if !strings.Contains(out, want) {
			t.Errorf("resume text lacks %q", want)
		}
	}
	if strings.Contains(out, "HELP-MARKER") {
		t.Fatal("ask_for_help_when reached resume text")
	}
}
