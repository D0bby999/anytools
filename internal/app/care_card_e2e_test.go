package app

// care_card_e2e_test.go — plans/261017-1828-up-f13ff2d-upgrade, phase 1,
// over HTTP: the care card's "next review date" is its review. It is due on
// that day in the learner's own zone, not before, and Home's list shows it
// as a private note without its title. TestLifeToolkitIsPrivateEndToEnd
// covers its evidence refusal and export; TestPrivateWorksheetsNeverReachAModel
// its model inputs.

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/learning/worksheet"
	"github.com/D0bby999/anytools/internal/store/pg"
)

func TestTheCareCardsReviewDateIsDueOnTheLearnersDay(t *testing.T) {
	e := buildE2E(t, "http://127.0.0.1:9", nil, nil)

	// UTC+14: for most of the UTC day the learner's day is already the next
	// one, so a server-day check would not find the review due.
	const zone = "Pacific/Kiritimati"
	if _, err := pg.NewUserStore(e.pool).SetTimezone(context.Background(), e.user, zone, false); err != nil {
		t.Fatal(err)
	}
	today := learning.LocalDay(time.Now(), zone)
	tomorrow := learning.LocalDay(time.Now().AddDate(0, 0, 1), zone)

	created := e.json(http.MethodPost, "/v1/worksheets", map[string]any{
		"kind": "life_care_card", "title": privateMarker + " Lifts to the clinic"}, http.StatusCreated)
	id := created["id"].(string)
	if created["private"] != true {
		t.Fatalf("stored as private %v", created["private"])
	}
	if len(e.json(http.MethodGet, "/v1/worksheets/due", nil, http.StatusOK)["due"].([]any)) != 0 {
		t.Fatal("due before a review date was written")
	}

	patch := func(revision any, day learning.Day) map[string]any {
		return e.json(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{"revision": revision,
			"answers": map[string]any{"review": map[string]any{"review_date": day.String()}}}, http.StatusOK)
	}
	saved := patch(created["updated_at"], tomorrow)
	if r := saved["reviews"].(map[string]any)["review"].(map[string]any); r["due"] != tomorrow.String() {
		t.Fatalf("review %v, want %s", r, tomorrow)
	}
	if n := len(e.json(http.MethodGet, "/v1/worksheets/due", nil, http.StatusOK)["due"].([]any)); n != 0 {
		t.Fatalf("%d due the day before the review date", n)
	}

	patch(saved["updated_at"], today)
	noMarker(t, "GET /v1/worksheets/due", e.raw(http.MethodGet, "/v1/worksheets/due", nil))
	due := e.json(http.MethodGet, "/v1/worksheets/due", nil, http.StatusOK)["due"].([]any)
	if len(due) != 1 {
		t.Fatalf("due on the review date = %v", due)
	}
	d := due[0].(map[string]any)
	if d["id"] != id || d["review"] != "review" || d["label"] != "Next review date" ||
		d["private"] != true || d["title"] != worksheet.PrivateTitle {
		t.Errorf("due entry %v", d)
	}
}
