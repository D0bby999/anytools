package worksheet

import (
	"errors"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/learning"
)

// A kind's Check runs on the merged answers and the resulting status, on a
// section write and on a status change, and its refusal names the field
// (phase 10's "a stop needs its three actions" is this shape).
func TestAKindsCheckRunsOnStatusChangesAndSectionWrites(t *testing.T) {
	k := Kind{Kind: "check_probe", Name: "C", Group: GroupProjects, Source: "s", Version: 1,
		Sections: []Section{{Key: "close", Title: "Close", Fields: []Field{
			{Key: "decision", Label: "Decision", Type: Choice, Options: []string{"continue", "stop"}},
			{Key: "actions", Label: "Stop actions", Type: Long},
		}}},
		Check: func(a Answers, status string) error {
			if a["close"]["decision"] == "stop" && a["close"]["actions"] == nil {
				return &FieldError{Field: "close.actions", Reason: "a stop needs its actions"}
			}
			if status == StatusDone && a["close"]["decision"] == nil {
				return &FieldError{Field: "close.decision", Reason: "decide before closing"}
			}
			return nil
		}}
	if err := checkKind(&k); err != nil {
		t.Fatal(err)
	}
	s := &Service{}
	day := learning.Day{Year: 2026, Month: time.October, Day: 1}
	w := &Worksheet{Answers: Answers{}, Status: StatusOpen, Reviews: map[string]ReviewDate{}}

	done := StatusDone
	var fe *FieldError
	err := s.finish(&k, w, &Write{Status: &done, Sections: map[string]map[string]any{}}, day, day, nil)
	if !errors.As(err, &fe) || fe.Field != "close.decision" {
		t.Fatalf("closing undecided: %v", err)
	}
	err = s.finish(&k, w, &Write{Sections: map[string]map[string]any{"close": {"decision": "stop"}}}, day, day, nil)
	if !errors.As(err, &fe) || fe.Field != "close.actions" {
		t.Fatalf("a stop without actions: %v", err)
	}
	if err := s.finish(&k, w, &Write{Status: &done, Sections: map[string]map[string]any{
		"close": {"decision": "stop", "actions": "pause, tell the team, archive"}}}, day, day, nil); err != nil {
		t.Fatalf("a complete close: %v", err)
	}
}

// The 200 KB bound is on the whole merged worksheet, not one request.
func TestTheWholeWorksheetIsBounded(t *testing.T) {
	big := make([]byte, MaxLong)
	for i := range big {
		big[i] = 'x'
	}
	w := &Worksheet{Answers: Answers{}, Reviews: map[string]ReviewDate{}}
	for i := 0; i < 45; i++ {
		w.Answers[string(rune('a'+i%26))+string(rune('a'+i/26))] = map[string]any{"f": string(big)}
	}
	day := learning.Day{Year: 2026, Month: time.October, Day: 1}
	err := (&Service{}).finish(&example, w, &Write{Sections: map[string]map[string]any{
		"boundary": {"situation": string(big)}}}, day, day, nil)
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("a worksheet over %d bytes: %v", MaxAnswers, err)
	}
}
