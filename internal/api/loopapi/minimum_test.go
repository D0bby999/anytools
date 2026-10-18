package loopapi_test

import (
	"net/http"
	"strings"
	"testing"
)

// TestMinimumContractRoundTripsOverHTTP: the state patch takes the three
// answers, the state page returns them, and an over-long one is a 400 that
// leaves the stored contract alone.
func TestMinimumContractRoundTripsOverHTTP(t *testing.T) {
	h := newHarness(t)
	g := seedAlice(t, h)
	path := "/v1/learning/states/" + g.state
	contract := map[string]any{
		"downshift_when":      "Less than six hours of sleep",
		"still_worth_keeping": "Read one headline aloud",
		"ask_for_help_when":   "Three bad weeks in a row",
	}
	h.json(t, h.alice, http.MethodPatch, path, map[string]any{"minimum_contract": contract}, http.StatusOK)

	got := h.json(t, h.alice, http.MethodGet, path, nil, http.StatusOK)["state"].(map[string]any)["minimum_contract"].(map[string]any)
	for k, v := range contract {
		if got[k] != v {
			t.Errorf("%s = %v, want %v", k, got[k], v)
		}
	}

	long := map[string]any{"downshift_when": strings.Repeat("a", 1001)}
	if s := h.status(t, h.alice, http.MethodPatch, path, map[string]any{"minimum_contract": long}); s != http.StatusBadRequest {
		t.Fatalf("over-long answer: status %d, want 400", s)
	}
	unknown := map[string]any{"downshift_when": "x", "mood": "low"}
	if s := h.status(t, h.alice, http.MethodPatch, path, map[string]any{"minimum_contract": unknown}); s != http.StatusBadRequest {
		t.Fatalf("unknown contract field: status %d, want 400", s)
	}
	again := h.json(t, h.alice, http.MethodGet, path, nil, http.StatusOK)["state"].(map[string]any)["minimum_contract"].(map[string]any)
	if again["downshift_when"] != contract["downshift_when"] {
		t.Fatalf("a refused patch changed the contract: %v", again)
	}
}

// TestInterruptionRecordOverHTTP: the six lines are stored; fact and the
// 24-hour output are required; an unknown resistance is refused.
func TestInterruptionRecordOverHTTP(t *testing.T) {
	h := newHarness(t)
	g := seedAlice(t, h)
	path := "/v1/learning/states/" + g.state + "/interrupt"
	full := map[string]any{
		"fact": "Two night shifts", "resistance": "energy", "minimum": "Learn two words",
		"within_24h": "Say two words aloud", "not_repaying": "Monday's list", "review_on": "2026-10-20",
	}
	for name, drop := range map[string]string{"no fact": "fact", "no 24-hour output": "within_24h"} {
		body := map[string]any{}
		for k, v := range full {
			if k != drop {
				body[k] = v
			}
		}
		if s := h.status(t, h.alice, http.MethodPost, path, body); s != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, s)
		}
	}
	bad := map[string]any{}
	for k, v := range full {
		bad[k] = v
	}
	bad["resistance"] = "laziness"
	if s := h.status(t, h.alice, http.MethodPost, path, bad); s != http.StatusBadRequest {
		t.Errorf("unknown resistance: status %d, want 400", s)
	}

	res := h.json(t, h.alice, http.MethodPost, path, full, http.StatusOK)
	ints := res["cycle"].(map[string]any)["interruptions"].([]any)
	if len(ints) != 1 {
		t.Fatalf("interruptions = %v (refused requests must not log one)", ints)
	}
	got := ints[0].(map[string]any)
	want := map[string]any{
		"fact": "Two night shifts", "resistance": "energy", "reduced_to": "Learn two words",
		"within_24h": "Say two words aloud", "not_repaying": "Monday's list", "review_on": "2026-10-20",
		"prior_task": "Learn ten words",
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %v, want %v", k, got[k], v)
		}
	}
	if st := res["state"].(map[string]any); st["next_task"] != "Learn two words" {
		t.Fatalf("next task = %v, want the reduced task", st["next_task"])
	}
}

// TestThreeEqualResistancesFlagTheState: the state page reports the repeated
// resistance after three in a row, not after two.
func TestThreeEqualResistancesFlagTheState(t *testing.T) {
	h := newHarness(t)
	g := seedAlice(t, h)
	state := "/v1/learning/states/" + g.state
	record := func(resistance string) {
		t.Helper()
		h.json(t, h.alice, http.MethodPost, state+"/interrupt", map[string]any{
			"fact": "Late meeting", "resistance": resistance, "minimum": "One word", "within_24h": "One word",
		}, http.StatusOK)
	}
	repeated := func() any {
		return h.json(t, h.alice, http.MethodGet, state, nil, http.StatusOK)["repeated_resistance"]
	}

	record("time")
	record("time")
	if r := repeated(); r != "" {
		t.Fatalf("after two: repeated_resistance = %v, want empty", r)
	}
	record("time")
	if r := repeated(); r != "time" {
		t.Fatalf("after three: repeated_resistance = %v, want time", r)
	}
	record("energy")
	if r := repeated(); r != "" {
		t.Fatalf("after a different one: repeated_resistance = %v, want empty", r)
	}
}
