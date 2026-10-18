package loopapi_test

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestStatesListIsScoped(t *testing.T) {
	h := newHarness(t)
	seedAlice(t, h)
	if got := h.json(t, h.bob, http.MethodGet, "/v1/learning/states", nil, http.StatusOK)["states"].([]any); len(got) != 0 {
		t.Fatalf("bob lists %d of alice's states", len(got))
	}
	if got := h.json(t, h.alice, http.MethodGet, "/v1/learning/states", nil, http.StatusOK)["states"].([]any); len(got) != 1 {
		t.Fatalf("alice lists %d states, want 1", len(got))
	}
}

// TestAMalformedIdIsIndistinguishableFromAForeignOne, including the query-
// string id the suggestion endpoint takes.
func TestAMalformedIdIsIndistinguishableFromAForeignOne(t *testing.T) {
	h := newHarness(t)
	for _, id := range []string{"not-a-uuid", uuid.Nil.String(), uuid.NewString()} {
		for _, path := range []string{"/v1/learning/states/" + id, "/v1/cycles/" + id,
			"/v1/learning/evidence/suggest?cycle_id=" + id} {
			if got := h.status(t, h.alice, http.MethodGet, path, nil); got != http.StatusNotFound {
				t.Errorf("GET %s: status %d, want 404", path, got)
			}
		}
	}
}

// TestEvidenceMustPointAtTheCallersOwnRecord: evidence is a pointer at
// something the product recorded, and it has to be the caller's.
func TestEvidenceMustPointAtTheCallersOwnRecord(t *testing.T) {
	h := newHarness(t)
	g := seedAlice(t, h)
	path := "/v1/weekly-reviews/" + g.review + "/evidence"
	cases := []struct {
		name string
		body map[string]any
		want int
	}{
		{"bob's attempt", map[string]any{"kind": "question_attempt", "ref_id": h.seedAttempt(t, h.bob)}, http.StatusNotFound},
		{"nothing at all", map[string]any{"kind": "note", "ref_id": uuid.NewString()}, http.StatusNotFound},
		{"research before phase 9", map[string]any{"kind": "research_report", "ref_id": uuid.NewString()}, http.StatusNotFound},
		{"unknown kind", map[string]any{"kind": "vibes", "ref_id": uuid.NewString()}, http.StatusBadRequest},
		{"unknown timepoint", map[string]any{"kind": "note", "ref_id": uuid.NewString(), "timepoint": "soon"}, http.StatusBadRequest},
	}
	for _, tc := range cases {
		if got := h.status(t, h.alice, http.MethodPost, path, tc.body); got != tc.want {
			t.Errorf("%s: status %d, want %d", tc.name, got, tc.want)
		}
	}
}

func TestScoresOutsideZeroToTwoAreRefused(t *testing.T) {
	h := newHarness(t)
	g := seedAlice(t, h)
	for _, n := range []int{-1, 3} {
		if got := h.status(t, h.alice, http.MethodPatch, "/v1/weekly-reviews/"+g.review,
			map[string]any{"transfer": n}); got != http.StatusBadRequest {
			t.Errorf("transfer=%d: status %d, want 400", n, got)
		}
	}
}

// TestAShutGateSaysWhatIsMissingAndWhatItCannotProve.
func TestAShutGateSaysWhatIsMissingAndWhatItCannotProve(t *testing.T) {
	h := newHarness(t)
	g := seedAlice(t, h)
	body := h.json(t, h.alice, http.MethodPost, "/v1/cycles/"+g.cycle+"/advance", nil, http.StatusConflict)
	if body["code"] != "gate_closed" || len(body["problems"].([]any)) == 0 {
		t.Fatalf("advance body = %v", body)
	}
	gate := body["gate"].(map[string]any)
	if gate["open"] != false || len(gate["cannot_prove"].([]any)) == 0 {
		t.Fatalf("gate = %v", gate)
	}
}

func TestInterruptionShrinksTheNextTask(t *testing.T) {
	h := newHarness(t)
	g := seedAlice(t, h)
	path := "/v1/learning/states/" + g.state + "/interrupt"
	// No minimum written anywhere: refused rather than dropping the task.
	// (Phase 13: the fact and the 24-hour output are required too.)
	lines := map[string]any{"fact": "ill", "within_24h": "Read one word"}
	if got := h.status(t, h.alice, http.MethodPost, path, lines); got != http.StatusBadRequest {
		t.Fatalf("interrupt without a minimum: status %d, want 400", got)
	}
	lines["minimum"] = "Learn two words"
	res := h.json(t, h.alice, http.MethodPost, path, lines, http.StatusOK)
	st := res["state"].(map[string]any)
	cyc := res["cycle"].(map[string]any)
	if st["next_task"] != "Learn two words" || len(cyc["interruptions"].([]any)) != 1 {
		t.Fatalf("after interrupt: %v", res)
	}
	if prior := cyc["interruptions"].([]any)[0].(map[string]any)["prior_task"]; prior != "Learn ten words" {
		t.Fatalf("prior task = %v", prior)
	}
}
