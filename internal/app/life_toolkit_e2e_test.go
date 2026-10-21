package app

// life_toolkit_e2e_test.go — up-methods phase 9 over HTTP: up's life
// practice toolkit is five private kinds, and f13ff2d added the care card as
// a sixth. Each is served, takes no learning state, holds the learner's
// words in every text field, is refused as evidence, shows on the due list
// as "Private note" only, and exports with private: true. TestPrivateWorksheetsNeverReachAModel seeds the same six
// (it iterates every private kind) and checks every model input.

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/learning/worksheet"
	"github.com/D0bby999/anytools/internal/learning/worksheet/worksheettest"
)

// lifeKinds are phase 9's five, and the care card up added at f13ff2d
// (the private design notes, phase 1).
var lifeKinds = []string{"choice_brief", "attention_audit", "relationship_card", "recovery_reset", "life_weekly_review",
	"life_care_card"}

// textFields counts the fields worksheettest.Fill writes the marker into.
func textFields(k *worksheet.Kind) int {
	n := 0
	for _, s := range k.Sections {
		for _, f := range s.Fields {
			switch f.Type {
			case worksheet.Text, worksheet.Long:
				n++
			case worksheet.Choice:
				if f.Other {
					n++
				}
			case worksheet.Table:
				for _, c := range f.Columns {
					if c.Type == worksheet.Text || c.Type == worksheet.Long {
						n++
					}
				}
			}
		}
	}
	return n
}

func TestLifeToolkitIsPrivateEndToEnd(t *testing.T) {
	e := buildE2E(t, "http://127.0.0.1:9", nil, nil)
	ctx := context.Background()

	served := map[string]map[string]any{}
	for _, k := range e.json(http.MethodGet, "/v1/worksheet-kinds", nil, http.StatusOK)["kinds"].([]any) {
		m := k.(map[string]any)
		served[m["kind"].(string)] = m
	}

	started := e.json(http.MethodPost, "/v1/learning/states", map[string]string{
		"goal": "Keep a steady week", "real_scenario": "Work and home",
		"outcome_12w": "A calmer rhythm", "first_task": "One note a day",
	}, http.StatusCreated)
	stateID := mapAt(started, "state")["id"].(string)
	cycleID := mapAt(started, "cycle")["id"].(string)
	chainID := e.json(http.MethodPost, "/v1/learning/states/"+stateID+"/chains", map[string]any{"question": "q"}, http.StatusCreated)["id"].(string)
	reviewID := e.json(http.MethodPost, "/v1/cycles/"+cycleID+"/reviews", map[string]any{"week": 1}, http.StatusCreated)["id"].(string)

	for _, id := range lifeKinds {
		k, ok := worksheet.Lookup(id)
		if !ok || served[id] == nil {
			t.Fatalf("%s is not registered and served", id)
		}
		if served[id]["private"] != true || served[id]["group"] != "life" {
			t.Errorf("%s served as private %v, group %v", id, served[id]["private"], served[id]["group"])
		}

		// Attached to nothing: a learning state is refused.
		if body := e.json(http.MethodPost, "/v1/worksheets", map[string]any{"kind": id, "title": "x", "state_id": stateID},
			http.StatusBadRequest); body["field"] != "state_id" {
			t.Errorf("%s with a state = %v", id, body)
		}

		created := e.json(http.MethodPost, "/v1/worksheets", map[string]any{"kind": id, "title": privateMarker + " " + k.Name}, http.StatusCreated)
		wsID := created["id"].(string)
		if created["private"] != true {
			t.Errorf("%s stored as private %v", id, created["private"])
		}

		// The marker lands in every field that holds text.
		res := e.do(http.MethodPatch, "/v1/worksheets/"+wsID, map[string]any{
			"revision": created["updated_at"], "answers": worksheettest.Fill(k, privateMarker)})
		raw, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("%s: filling every field = %d %s", id, res.StatusCode, raw)
		}
		if got, want := strings.Count(string(raw), privateMarker), textFields(k)+1; got != want {
			t.Errorf("%s: the marker is in %d places, want every text field and the title (%d)", id, got, want)
		}

		// Refused as evidence, everywhere it could be added. The routes
		// answer as for a worksheet that does not exist (phase 0: OwnsTarget
		// is false for a private worksheet).
		if got := e.status(http.MethodPost, "/v1/learning/chains/"+chainID+"/evidence",
			map[string]any{"kind": "worksheet", "ref_id": wsID, "timepoint": "baseline"}); got != http.StatusNotFound {
			t.Errorf("%s attached to a chain: %d", id, got)
		}
		if got := e.status(http.MethodPost, "/v1/weekly-reviews/"+reviewID+"/evidence",
			map[string]any{"kind": "worksheet", "ref_id": wsID}); got != http.StatusNotFound {
			t.Errorf("%s attached to a review: %d", id, got)
		}

		// The export is the learner's own, and says it is private.
		res = e.do(http.MethodGet, "/v1/worksheets/"+wsID+"/export", nil)
		md, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != http.StatusOK || !strings.Contains(string(md), "\nprivate: true\n") {
			t.Errorf("%s export = %d:\n%.400s", id, res.StatusCode, md)
		}

		if _, err := e.pool.Exec(ctx, `UPDATE worksheets SET reviews = '{"r":{"due":"2000-01-01","earliest":"2000-01-01"}}' WHERE id = $1`, wsID); err != nil {
			t.Fatal(err)
		}
	}

	// Home's source: every life worksheet is due, and none shows its title.
	raw := e.raw(http.MethodGet, "/v1/worksheets/due", nil)
	noMarker(t, "GET /v1/worksheets/due", raw)
	due := e.json(http.MethodGet, "/v1/worksheets/due", nil, http.StatusOK)
	if due["count"] != float64(len(lifeKinds)) {
		t.Fatalf("due = %v", due)
	}
	for _, d := range due["due"].([]any) {
		m := d.(map[string]any)
		if m["private"] != true || m["title"] != worksheet.PrivateTitle {
			t.Errorf("due entry %v", m)
		}
	}
	// The learning state's evidence surfaces never list them.
	noMarker(t, "GET /v1/learning/evidence/suggest", e.raw(http.MethodGet, "/v1/learning/evidence/suggest?cycle_id="+cycleID, nil))
}
