package worksheet

import (
	"errors"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/learning"
)

// The startup experiment (phase 2 of a private plan): up's one
// card in the phase's order of sections, its four decisions, and the next
// review on the date the learner writes.

func TestTheStartupExperimentFollowsUpsOneCard(t *testing.T) {
	k := lookupKind(t, StartupExperimentKind)
	var keys []string
	for i, s := range k.Sections {
		keys = append(keys, s.Key)
		if s.Continues != (i > 0) {
			t.Errorf("%s: every section after the first continues up's one card", s.Key)
		}
	}
	want := []string{"assumption", "alternatives", "counterevidence", "pilot", "limits", "result", "conclusion"}
	if len(keys) != len(want) {
		t.Fatalf("sections %v, want %v", keys, want)
	}
	for i := range want {
		if keys[i] != want[i] {
			t.Fatalf("sections %v, want %v", keys, want)
		}
	}
	if _, err := Validate(k, sections(t, map[string]any{"conclusion": map[string]any{
		"decision": "insufficient evidence, pause", "supports": "A first payment signal; delivery cost not yet workable"}})); err != nil {
		t.Fatalf("up's fourth decision: %v", err)
	}
	if _, err := Validate(k, sections(t, map[string]any{"conclusion": map[string]any{"decision": "validated"}})); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a decision outside up's four: %v", err)
	}
}

func TestTheStartupExperimentsNextReviewFollowsItsDate(t *testing.T) {
	k := lookupKind(t, StartupExperimentKind)
	created := learning.Day{Year: 2026, Month: time.October, Day: 1}
	w, write := writer(t, k, created)
	if err := write(created, map[string]any{"conclusion": map[string]any{"next_review": "2026-10-15"}}); err != nil {
		t.Fatal(err)
	}
	if r := w.Reviews["next_review"]; r.Due != "2026-10-15" {
		t.Fatalf("next review = %+v", r)
	}
	if err := write(created, map[string]any{"conclusion": map[string]any{"next_review": nil}}); err != nil {
		t.Fatal(err)
	}
	if _, ok := w.Reviews["next_review"]; ok {
		t.Fatalf("clearing the date leaves the review: %+v", w.Reviews)
	}
}
