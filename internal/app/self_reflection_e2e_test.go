package app

// self_reflection_e2e_test.go — the private design notes, phase
// 3, over HTTP: the self-reflection cards are one private kind. A worksheet
// with one card written saves and exports; the thirty-day experiment's retest
// date puts it on Home's due list on that day, as "Private note" only; and it
// is refused as evidence. TestPrivateWorksheetsNeverReachAModel seeds it with
// every other private kind and checks every model input.

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/learning/worksheet"
	"github.com/D0bby999/anytools/internal/store/pg"
)

func TestTheSelfReflectionCardsEndToEnd(t *testing.T) {
	e := buildE2E(t, "http://127.0.0.1:9", nil, nil)
	ctx := context.Background()

	var served map[string]any
	for _, k := range e.json(http.MethodGet, "/v1/worksheet-kinds", nil, http.StatusOK)["kinds"].([]any) {
		if m := k.(map[string]any); m["kind"] == "self_reflection" {
			served = m
		}
	}
	if served == nil {
		t.Fatal("self_reflection is not served")
	}
	if sections, _ := served["sections"].([]any); served["private"] != true || served["group"] != "life" || len(sections) != 11 {
		t.Fatalf("self_reflection served as private %v, group %v, %d sections", served["private"], served["group"], len(sections))
	}

	created := e.json(http.MethodPost, "/v1/worksheets", map[string]any{
		"kind": "self_reflection", "title": privateMarker + " cards"}, http.StatusCreated)
	id := created["id"].(string)
	if created["private"] != true {
		t.Fatalf("stored as private %v", created["private"])
	}

	// One card is enough.
	saved := e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{
		"revision": created["updated_at"],
		"answers": map[string]any{"work_note": map[string]any{
			"fact": privateMarker + " skipped the call", "support": "a reminder the night before"}},
	}, http.StatusOK)
	if len(saved["reviews"].(map[string]any)) != 0 {
		t.Fatalf("a review was scheduled with no retest date: %v", saved["reviews"])
	}
	reopened := e.json(http.MethodGet, "/v1/worksheets/"+id, nil, http.StatusOK)
	if got := mapAt(reopened, "worksheet", "answers", "work_note")["support"]; got != "a reminder the night before" {
		t.Fatalf("the card did not survive a reload: %v", reopened)
	}
	res := e.do(http.MethodGet, "/v1/worksheets/"+id+"/export", nil)
	md, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || !strings.Contains(string(md), "\nprivate: true\n") ||
		!strings.Contains(string(md), "a reminder the night before") {
		t.Fatalf("export = %d:\n%.600s", res.StatusCode, md)
	}

	// The retest date is the review: not due the day before, due on the day.
	zone, err := pg.NewUserStore(e.pool).Timezone(ctx, e.user)
	if err != nil {
		t.Fatal(err)
	}
	loc, err := learning.LoadZone(zone)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().In(loc)
	today, tomorrow := now.Format("2006-01-02"), now.AddDate(0, 0, 1).Format("2006-01-02")
	saved = e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{
		"revision": saved["updated_at"],
		"answers":  map[string]any{"hypothesis": map[string]any{"retest_on": tomorrow}},
	}, http.StatusOK)
	if got := mapAt(mapAt(saved, "reviews"), "retest")["due"]; got != tomorrow {
		t.Fatalf("retest due %v, want %s", got, tomorrow)
	}
	if due := e.json(http.MethodGet, "/v1/worksheets/due", nil, http.StatusOK); due["count"] != float64(0) {
		t.Fatalf("due before its day: %v", due)
	}
	e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{
		"revision": saved["updated_at"],
		"answers":  map[string]any{"hypothesis": map[string]any{"retest_on": today}},
	}, http.StatusOK)
	raw := e.raw(http.MethodGet, "/v1/worksheets/due", nil)
	noMarker(t, "GET /v1/worksheets/due", raw)
	due := e.json(http.MethodGet, "/v1/worksheets/due", nil, http.StatusOK)
	if due["count"] != float64(1) {
		t.Fatalf("not due on its retest date: %v", due)
	}
	entry := due["due"].([]any)[0].(map[string]any)
	if entry["private"] != true || entry["title"] != worksheet.PrivateTitle || entry["review"] != "retest" {
		t.Errorf("due entry %v", entry)
	}

	// Refused as evidence, as a worksheet that does not exist.
	started := e.json(http.MethodPost, "/v1/learning/states", map[string]string{
		"goal": "Keep going", "real_scenario": "Evenings",
		"outcome_12w": "A steady habit", "first_task": "Ten minutes",
	}, http.StatusCreated)
	stateID := mapAt(started, "state")["id"].(string)
	cycleID := mapAt(started, "cycle")["id"].(string)
	chainID := e.json(http.MethodPost, "/v1/learning/states/"+stateID+"/chains", map[string]any{"question": "q"}, http.StatusCreated)["id"].(string)
	reviewID := e.json(http.MethodPost, "/v1/cycles/"+cycleID+"/reviews", map[string]any{"week": 1}, http.StatusCreated)["id"].(string)
	if got := e.status(http.MethodPost, "/v1/learning/chains/"+chainID+"/evidence",
		map[string]any{"kind": "worksheet", "ref_id": id, "timepoint": "baseline"}); got != http.StatusNotFound {
		t.Errorf("attached to a chain: %d", got)
	}
	if got := e.status(http.MethodPost, "/v1/weekly-reviews/"+reviewID+"/evidence",
		map[string]any{"kind": "worksheet", "ref_id": id}); got != http.StatusNotFound {
		t.Errorf("attached to a review: %d", got)
	}
	noMarker(t, "GET /v1/learning/evidence/suggest", e.raw(http.MethodGet, "/v1/learning/evidence/suggest?cycle_id="+cycleID, nil))
}
