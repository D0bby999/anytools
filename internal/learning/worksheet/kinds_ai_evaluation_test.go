package worksheet

import (
	"errors"
	"testing"

	"github.com/D0bby999/anytools/internal/learning"
)

// The AI evaluation (phase 2 of 261017-1828-up-f13ff2d-upgrade): each
// version's rates are counted from its case rows with failures and timeouts
// among the attempts, and a stored rate that disagrees is refused when the
// results are written — not when a later case makes it out of date.

func evaluationAttempt(version, first, final string) map[string]any {
	cells := map[string]any{EvaluationVersion: version}
	if first != "" {
		cells[EvaluationFirstPass] = first
	}
	if final != "" {
		cells[EvaluationFinal] = final
	}
	return map[string]any{"row": "", "cells": cells}
}

func TestATimeoutCountsAsAFailedAttempt(t *testing.T) {
	k := lookupKind(t, AIEvaluationKind)
	clean, err := Validate(k, sections(t, map[string]any{EvaluationCases: map[string]any{EvaluationCasesTable: []any{
		evaluationAttempt(VersionCurrent, AttemptPass, FinalAccepted),
		evaluationAttempt(VersionCurrent, AttemptFail, FinalAccepted),
		evaluationAttempt(VersionCurrent, AttemptTimeout, FinalTimeout),
		evaluationAttempt(VersionCandidate, AttemptPass, FinalAccepted),
		// Not yet judged: not an attempt of either version yet.
		evaluationAttempt(VersionCandidate, "", ""),
	}}}))
	if err != nil {
		t.Fatal(err)
	}
	got := EvaluationRatesOf(clean[EvaluationCases][EvaluationCasesTable])
	if c := got[VersionCurrent]; c != (Rate{FirstPass: 1, Revised: 2, Attempts: 3}) {
		t.Fatalf("current = %+v, want 1 first pass and 2 accepted of 3 attempts", c)
	}
	if c := got[VersionCandidate]; c != (Rate{FirstPass: 1, Revised: 1, Attempts: 1}) {
		t.Fatalf("candidate = %+v", c)
	}
	// The stored shape counts the same.
	if again := EvaluationRatesOf(normalize(clean[EvaluationCases][EvaluationCasesTable])); again[VersionCurrent] != got[VersionCurrent] {
		t.Fatalf("stored rows count %+v, cleaned rows %+v", again, got)
	}
	if _, err := Validate(k, sections(t, map[string]any{EvaluationCases: map[string]any{EvaluationCasesTable: []any{
		evaluationAttempt("v3", AttemptPass, "")}}})); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a version the record does not compare: %v", err)
	}
}

func TestAStoredRateMustAgreeWithTheCaseRows(t *testing.T) {
	k := lookupKind(t, AIEvaluationKind)
	day := learning.Day{Year: 2026, Month: 10, Day: 3}
	_, write := writer(t, k, day)
	attempts := []any{
		evaluationAttempt(VersionCurrent, AttemptPass, FinalAccepted),
		evaluationAttempt(VersionCurrent, AttemptFail, FinalAccepted),
		evaluationAttempt(VersionCurrent, AttemptTimeout, FinalTimeout),
	}
	if err := write(day, map[string]any{EvaluationCases: map[string]any{EvaluationCasesTable: attempts}}); err != nil {
		t.Fatal(err)
	}
	rate := func(version, col, v string) map[string]any {
		return map[string]any{EvaluationResults: map[string]any{EvaluationRates: []any{
			map[string]any{"row": version, "cells": map[string]any{col: v}}}}}
	}
	var fe *FieldError
	for _, c := range []struct{ name, col, v, field string }{
		{"the timeout left out", EvaluationFirstPass, "1/2", "results.rates[0].first_pass"},
		{"the timeout counted as a pass", EvaluationFirstPass, "2/3", "results.rates[0].first_pass"},
		{"a percentage", EvaluationFirstPass, "33%", "results.rates[0].first_pass"},
		{"revision counted wrongly", EvaluationRevised, "3/3", "results.rates[0].revised"},
	} {
		if err := write(day, rate(VersionCurrent, c.col, c.v)); !errors.As(err, &fe) || fe.Field != c.field {
			t.Errorf("%s: %v", c.name, err)
		}
	}
	// A version with no attempts has no rate but 0/0.
	if err := write(day, rate(VersionCandidate, EvaluationFirstPass, "1/1")); !errors.As(err, &fe) {
		t.Errorf("a rate for a version with no attempts: %v", err)
	}
	if err := write(day, rate(VersionCurrent, EvaluationFirstPass, "1 / 3")); err != nil {
		t.Fatalf("the rate the rows give: %v", err)
	}
	if err := write(day, rate(VersionCurrent, EvaluationRevised, "2/3")); err != nil {
		t.Fatalf("the revised rate the rows give: %v", err)
	}

	// A fourth case is accepted although the stored rate is now out of date.
	attempts = append(attempts, evaluationAttempt(VersionCurrent, AttemptPass, FinalAccepted))
	if err := write(day, map[string]any{EvaluationCases: map[string]any{EvaluationCasesTable: attempts}}); err != nil {
		t.Fatalf("a case added after the results: %v", err)
	}
	// Results written again are checked against the four.
	if err := write(day, map[string]any{EvaluationResults: map[string]any{"limits": "Ten cases, one attempt each"}}); !errors.As(err, &fe) {
		t.Fatalf("results saved with a rate the rows no longer give: %v", err)
	}
	stale := map[string]any{EvaluationResults: map[string]any{EvaluationRates: []any{
		map[string]any{"row": VersionCurrent, "cells": map[string]any{EvaluationFirstPass: "2/4", EvaluationRevised: "2/3"}}}}}
	if err := write(day, stale); !errors.As(err, &fe) || fe.Field != "results.rates[0].revised" {
		t.Fatalf("one rate fixed, the other still out of date: %v", err)
	}
	fixed := map[string]any{EvaluationResults: map[string]any{EvaluationRates: []any{
		map[string]any{"row": VersionCurrent, "cells": map[string]any{EvaluationFirstPass: "2/4", EvaluationRevised: "3/4"}}}}}
	if err := write(day, fixed); err != nil {
		t.Fatalf("both rates from the four rows: %v", err)
	}
}
