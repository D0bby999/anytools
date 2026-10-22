package vocab

import (
	"errors"
	"testing"
)

// A word to learn may be saved with its record left empty, or partly filled;
// every other decision still needs each of its fields.
func TestALearnRecordMayBeEmpty(t *testing.T) {
	got, err := CheckRecord(DecisionLearn, map[string]string{})
	if err != nil || len(got) != 0 {
		t.Fatalf("an empty learn record: %v %v", got, err)
	}
	got, err = CheckRecord(DecisionLearn, map[string]string{"sound": " hands the TURN back ", "cue": ""})
	if err != nil || got["sound"] != "hands the TURN back" || len(got) != 1 {
		t.Fatalf("a partial learn record: %v %v", got, err)
	}
	if _, err := CheckRecord(DecisionLearn, map[string]string{"why": "x"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a field learn does not have was accepted: %v", err)
	}
	for _, d := range []string{DecisionSkip, DecisionInfer, DecisionLookup, DecisionVerify} {
		if _, err := CheckRecord(d, map[string]string{}); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s accepted an empty record", d)
		}
	}
}
