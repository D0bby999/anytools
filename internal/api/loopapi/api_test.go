package loopapi_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/loopapi"
)

// aliceGraph is one of every resource, owned by alice.
type aliceGraph struct {
	state, cycle, review, evidence, chain, brief, log, card string
}

// cardBody is a valid reading card.
func cardBody() map[string]any {
	return map[string]any{"kind": "reading", "title": "Read a headline", "setup": map[string]string{
		"situation": "The morning paper", "source": "Tuổi Trẻ front page", "standard": "Tell a friend the story"}}
}

func seedAlice(t *testing.T, h *harness) aliceGraph {
	t.Helper()
	var g aliceGraph
	started := h.json(t, h.alice, http.MethodPost, "/v1/learning/states", map[string]string{
		"goal": "Read Vietnamese news", "real_scenario": "The morning paper",
		"outcome_12w": "One article unaided", "first_task": "Learn ten words",
	}, http.StatusCreated)
	g.state = started["state"].(map[string]any)["id"].(string)
	g.cycle = started["cycle"].(map[string]any)["id"].(string)
	g.review = h.json(t, h.alice, http.MethodPost, "/v1/cycles/"+g.cycle+"/reviews", nil, http.StatusCreated)["id"].(string)
	g.evidence = h.json(t, h.alice, http.MethodPost, "/v1/weekly-reviews/"+g.review+"/evidence",
		map[string]any{"kind": "question_attempt", "ref_id": h.seedAttempt(t, h.alice), "timepoint": "baseline"},
		http.StatusCreated)["id"].(string)
	g.chain = h.json(t, h.alice, http.MethodPost, "/v1/learning/states/"+g.state+"/chains",
		map[string]any{"question": "Can I read a headline?"}, http.StatusCreated)["id"].(string)
	g.brief = h.json(t, h.alice, http.MethodPost, "/v1/learning/states/"+g.state+"/briefs",
		map[string]any{"task": "Summarise an article"}, http.StatusCreated)["id"].(string)
	g.log = h.json(t, h.alice, http.MethodPost, "/v1/learning/briefs/"+g.brief+"/logs",
		map[string]any{}, http.StatusCreated)["log"].(map[string]any)["id"].(string)
	g.card = h.json(t, h.alice, http.MethodPost, "/v1/learning/states/"+g.state+"/cards",
		cardBody(), http.StatusCreated)["card"].(map[string]any)["id"].(string)
	return g
}

type probe struct {
	pattern string
	path    string
	body    any
}

// probes names, for every pattern with a resource id, a request that aims
// alice's id at the route. The list is keyed by pattern so the check below can
// tell which routes are covered.
func probes(g aliceGraph, bobAttempt uuid.UUID) []probe {
	ev := map[string]any{"kind": "question_attempt", "ref_id": bobAttempt, "timepoint": "delayed"}
	s, c, r := "/v1/learning/states/"+g.state, "/v1/cycles/"+g.cycle, "/v1/weekly-reviews/"+g.review
	ch, b, l := "/v1/learning/chains/"+g.chain, "/v1/learning/briefs/"+g.brief, "/v1/learning/logs/"+g.log
	e := "/v1/learning/evidence/" + g.evidence
	k := "/v1/learning/cards/" + g.card
	return []probe{
		{"GET /v1/learning/states/{id}", s, nil},
		{"PATCH /v1/learning/states/{id}", s, map[string]any{"goal": "stolen"}},
		{"DELETE /v1/learning/states/{id}", s, nil},
		{"POST /v1/learning/states/{id}/interrupt", s + "/interrupt",
			map[string]any{"fact": "x", "within_24h": "x", "minimum": "x"}},
		{"POST /v1/learning/states/{id}/cycles", s + "/cycles", nil},
		{"POST /v1/learning/states/{id}/resume", s + "/resume", nil},
		{"POST /v1/learning/states/{id}/handover", s + "/handover", map[string]any{"text": "{}"}},
		{"GET /v1/learning/states/{id}/chains", s + "/chains", nil},
		{"POST /v1/learning/states/{id}/chains", s + "/chains", map[string]any{"question": "q"}},
		{"GET /v1/learning/states/{id}/briefs", s + "/briefs", nil},
		{"POST /v1/learning/states/{id}/briefs", s + "/briefs", map[string]any{"task": "t"}},
		{"GET /v1/cycles/{id}", c, nil},
		{"PATCH /v1/cycles/{id}", c, map[string]any{"day90_review_md": "x"}},
		{"POST /v1/cycles/{id}/advance", c + "/advance", nil},
		{"POST /v1/cycles/{id}/reviews", c + "/reviews", map[string]any{"week": 2}},
		{"GET /v1/weekly-reviews/{id}", r, nil},
		{"PATCH /v1/weekly-reviews/{id}", r, map[string]any{"quality": 2}},
		{"POST /v1/weekly-reviews/{id}/writeback", r + "/writeback", nil},
		{"POST /v1/weekly-reviews/{id}/evidence", r + "/evidence", ev},
		{"GET /v1/learning/evidence/suggest", "/v1/learning/evidence/suggest?cycle_id=" + g.cycle, nil},
		{"PATCH /v1/learning/evidence/{id}", e, map[string]any{"status": "dismissed"}},
		{"DELETE /v1/learning/evidence/{id}", e, nil},
		{"GET /v1/learning/chains/{id}", ch, nil},
		{"PATCH /v1/learning/chains/{id}", ch, map[string]any{"question": "q"}},
		{"DELETE /v1/learning/chains/{id}", ch, nil},
		{"POST /v1/learning/chains/{id}/evidence", ch + "/evidence", ev},
		{"GET /v1/learning/briefs/{id}", b, nil},
		{"PATCH /v1/learning/briefs/{id}", b, map[string]any{"task": "t"}},
		{"DELETE /v1/learning/briefs/{id}", b, nil},
		{"POST /v1/learning/briefs/{id}/logs", b + "/logs", map[string]any{}},
		{"GET /v1/learning/logs/{id}", l, nil},
		{"PATCH /v1/learning/logs/{id}", l, map[string]any{"next_cycle_decision": "x"}},
		{"DELETE /v1/learning/logs/{id}", l, nil},
		{"POST /v1/learning/states/{id}/cards", s + "/cards", cardBody()},
		{"GET /v1/learning/cards/{id}", k, nil},
		{"POST /v1/learning/cards/{id}/entries", k + "/entries", map[string]any{"timepoint": "baseline", "body": "stolen"}},
		{"POST /v1/learning/cards/{id}/close", k + "/close", map[string]any{"held": "x"}},
	}
}

// collectionRoutes carry no resource id: they are scoped by the
// authenticated user alone, and TestStatesListIsScoped covers them.
var collectionRoutes = map[string]bool{
	"GET /v1/learning/states":  true,
	"POST /v1/learning/states": true,
	// The kinds table is the same for everyone; the retest list is the
	// caller's own (TestRetestsDueAreTheCallersOwn).
	"GET /v1/learning/card-kinds": true,
	"GET /v1/learning/retests":    true,
}

// TestCrossUserIsolationOnEveryIdRoute: bob aims every id route at alice's
// resources and gets 404 each time — and afterwards alice's graph is intact,
// so none of the writes landed quietly.
func TestCrossUserIsolationOnEveryIdRoute(t *testing.T) {
	h := newHarness(t)
	g := seedAlice(t, h)
	for _, p := range probes(g, h.seedAttempt(t, h.bob)) {
		method := strings.SplitN(p.pattern, " ", 2)[0]
		if got := h.status(t, h.bob, method, p.path, p.body); got != http.StatusNotFound {
			t.Errorf("bob %s %s: status %d, want 404", method, p.path, got)
		}
	}
	st := h.json(t, h.alice, http.MethodGet, "/v1/learning/states/"+g.state, nil, http.StatusOK)
	if goal := st["state"].(map[string]any)["goal"]; goal != "Read Vietnamese news" {
		t.Fatalf("alice's goal is now %v", goal)
	}
	for _, path := range []string{"/v1/learning/chains/" + g.chain, "/v1/learning/briefs/" + g.brief, "/v1/learning/logs/" + g.log} {
		h.json(t, h.alice, http.MethodGet, path, nil, http.StatusOK)
	}
	card := h.json(t, h.alice, http.MethodGet, "/v1/learning/cards/"+g.card, nil, http.StatusOK)
	if n := len(card["entries"].([]any)); n != 0 {
		t.Fatalf("bob wrote %d entries on alice's card", n)
	}
	rv := h.json(t, h.alice, http.MethodGet, "/v1/weekly-reviews/"+g.review, nil, http.StatusOK)
	if ev := rv["evidence"].([]any); len(ev) != 1 || ev[0].(map[string]any)["status"] != "accepted" {
		t.Fatalf("alice's evidence changed: %v", ev)
	}
}

// TestEveryIdRouteIsProbed keeps the sweep honest: a new route in Patterns()
// that no probe touches fails here.
func TestEveryIdRouteIsProbed(t *testing.T) {
	probed := map[string]bool{}
	for _, p := range probes(aliceGraph{}, uuid.Nil) {
		probed[p.pattern] = true
	}
	for _, p := range loopapi.Patterns() {
		if !probed[p] && !collectionRoutes[p] {
			t.Errorf("%s has no cross-user probe in TestCrossUserIsolationOnEveryIdRoute", p)
		}
	}
	for p := range probed {
		found := false
		for _, q := range loopapi.Patterns() {
			found = found || q == p
		}
		if !found {
			t.Errorf("probe for %s names a route that is not registered", p)
		}
	}
}
