package worksheet

import (
	"errors"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/learning"
)

// The AI trend radar (phase 2 of 261017-1828-up-f13ff2d-upgrade): no decision
// and no "done" without §1's primary source, up's option lists as choices,
// and the thirty-day review from the decision.

func TestATrendDecisionNeedsItsPrimarySource(t *testing.T) {
	k := lookupKind(t, AITrendRadarKind)
	decided := Answers{TrendDecision: {TrendDecision: "continue"}}
	var fe *FieldError
	if err := k.Check(decided, StatusOpen); !errors.As(err, &fe) || fe.Field != "signal.source" {
		t.Fatalf("a decision with no primary source: %v", err)
	}
	if err := k.Check(Answers{TrendSignal: {"trend": "Realtime voice"}}, StatusDone); !errors.As(err, &fe) || fe.Field != "signal.source" {
		t.Fatalf("a radar marked done with no primary source: %v", err)
	}
	if err := k.Check(Answers{TrendSignal: {"trend": "Realtime voice"}}, StatusOpen); err != nil {
		t.Fatalf("an open radar still gathering its signal: %v", err)
	}
	decided[TrendSignal] = map[string]any{TrendSource: "The vendor's release notes, v2, read 2026-10-12"}
	if err := k.Check(decided, StatusDone); err != nil {
		t.Fatalf("a decision with its source: %v", err)
	}
}

func TestTheTrendRadarsChoicesAreUpsLists(t *testing.T) {
	k := lookupKind(t, AITrendRadarKind)
	ok := map[string]any{"experiment": map[string]any{"modes": []string{"audio", "image"}, "automation": "draft"},
		TrendDecision: map[string]any{TrendDecision: "downgrade"}}
	if _, err := Validate(k, sections(t, ok)); err != nil {
		t.Fatalf("up's options: %v", err)
	}
	for name, bad := range map[string]map[string]any{
		"a mode up does not list":  {"experiment": map[string]any{"modes": []string{"smell"}}},
		"automation beyond up's":   {"experiment": map[string]any{"automation": "anything goes"}},
		"a decision beyond up's 3": {TrendDecision: map[string]any{TrendDecision: "adopt everywhere"}},
	} {
		if _, err := Validate(k, sections(t, bad)); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}

	created := learning.Day{Year: 2026, Month: time.October, Day: 1}
	w, write := writer(t, k, created)
	if err := write(created, map[string]any{TrendSignal: map[string]any{TrendSource: "Model card, 2026-09-30"}}); err != nil {
		t.Fatal(err)
	}
	if len(w.Reviews) != 0 {
		t.Fatalf("a review before the decision: %+v", w.Reviews)
	}
	decided := learning.Day{Year: 2026, Month: time.October, Day: 5}
	if err := write(decided, map[string]any{TrendDecision: map[string]any{TrendDecision: "stop"}}); err != nil {
		t.Fatal(err)
	}
	if r := w.Reviews["thirty_day"]; r.Due != "2026-11-04" {
		t.Fatalf("thirty-day review = %+v, want 2026-11-04", r)
	}
}
