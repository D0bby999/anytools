package loop

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

func ref(tp, status string) GateRef {
	return GateRef{ID: uuid.New(), Kind: KindQuestionAttempt, Timepoint: tp, Status: status}
}

func TestEvaluateGate(t *testing.T) {
	cases := []struct {
		name        string
		in          GateInput
		open        bool
		missingHas  []string
		wantCounted int
	}{
		{
			name:       "calibrate with nothing",
			in:         GateInput{Phase: PhaseCalibrate},
			missingHas: []string{"baseline", "2 weekly reviews"},
		},
		{
			name:       "calibrate with reviews but no baseline",
			in:         GateInput{Phase: PhaseCalibrate, WrittenBackReviews: 2},
			missingHas: []string{"baseline"},
		},
		{
			name: "calibrate with a baseline only suggested",
			in: GateInput{Phase: PhaseCalibrate, WrittenBackReviews: 2,
				Refs: []GateRef{ref(TimepointBaseline, StatusSuggested)}},
			missingHas: []string{"baseline"},
		},
		{
			name: "calibrate with a dismissed baseline",
			in: GateInput{Phase: PhaseCalibrate, WrittenBackReviews: 3,
				Refs: []GateRef{ref(TimepointBaseline, StatusDismissed)}},
			missingHas: []string{"baseline"},
		},
		{
			name: "calibrate with a baseline and one review",
			in: GateInput{Phase: PhaseCalibrate, WrittenBackReviews: 1,
				Refs: []GateRef{ref(TimepointBaseline, StatusAccepted)}},
			missingHas: []string{"(1 done so far)"},
		},
		{
			name: "calibrate satisfied",
			in: GateInput{Phase: PhaseCalibrate, WrittenBackReviews: 2,
				Refs: []GateRef{ref(TimepointBaseline, StatusAccepted), ref("", StatusAccepted)}},
			open: true, wantCounted: 1,
		},
		{
			name: "stack with only delayed",
			in: GateInput{Phase: PhaseStack,
				Refs: []GateRef{ref(TimepointDelayed, StatusAccepted)}},
			missingHas: []string{"transfer"},
		},
		{
			name: "stack with only transfer",
			in: GateInput{Phase: PhaseStack,
				Refs: []GateRef{ref(TimepointTransfer, StatusAccepted)}},
			missingHas: []string{"delayed"},
		},
		{
			name: "stack ignores baselines and reviews",
			in: GateInput{Phase: PhaseStack, WrittenBackReviews: 12,
				Refs: []GateRef{ref(TimepointBaseline, StatusAccepted), ref(TimepointImmediate, StatusAccepted)}},
			missingHas: []string{"delayed", "transfer"},
		},
		{
			name: "stack satisfied",
			in: GateInput{Phase: PhaseStack,
				Refs: []GateRef{ref(TimepointDelayed, StatusAccepted), ref(TimepointTransfer, StatusAccepted)}},
			open: true, wantCounted: 2,
		},
		{
			name:       "deliver is final",
			in:         GateInput{Phase: PhaseDeliver, WrittenBackReviews: 12},
			missingHas: []string{"last phase"},
		},
		{
			name:       "unknown phase",
			in:         GateInput{Phase: "nope"},
			missingHas: []string{"Unknown phase"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := EvaluateGate(tc.in)
			if got.Open != tc.open {
				t.Fatalf("Open = %v, want %v (missing %v)", got.Open, tc.open, got.Missing)
			}
			if tc.open && len(got.Missing) != 0 {
				t.Fatalf("an open gate lists missing items: %v", got.Missing)
			}
			all := strings.Join(got.Missing, " | ")
			for _, want := range tc.missingHas {
				if !strings.Contains(all, want) {
					t.Errorf("missing %q not mentioned in %q", want, all)
				}
			}
			if tc.open && len(got.Counted) != tc.wantCounted {
				t.Errorf("counted %d refs, want %d", len(got.Counted), tc.wantCounted)
			}
			// The rule the UI depends on: every result, open or shut, says
			// what it cannot prove.
			if len(got.CannotProve) == 0 || strings.TrimSpace(got.CannotProve[0]) == "" {
				t.Error("result has no cannot-prove note")
			}
		})
	}
}

func TestNextPhaseOrder(t *testing.T) {
	if NextPhase(PhaseCalibrate) != PhaseStack || NextPhase(PhaseStack) != PhaseDeliver || NextPhase(PhaseDeliver) != "" {
		t.Fatal("phase order is calibrate → stack → deliver")
	}
}
