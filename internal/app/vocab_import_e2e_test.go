package app

import (
	"net/http"
	"strings"
	"testing"
)

// An Anki deck's batch through the real mux (plans/261020-1155-open-source-
// adds, phase 3): the words are saved as imported words to learn, a second
// batch of the same words is all duplicates, and a batch over the limit is
// refused whole.
func TestAnAnkiDeckBatchImportsThroughTheAPI(t *testing.T) {
	e := buildE2E(t, newTermsModel(t).server.URL, []string{"reading"}, nil)
	batch := map[string]any{"lang": "en", "notes": []map[string]string{
		{"term": "equilibrium", "meaning": "a balanced state", "sentence": "The market reached equilibrium."},
		{"term": "entropy", "meaning": "disorder"},
		{"term": "", "meaning": "no word"},
	}}
	res := e.json(http.MethodPost, "/v1/vocab/import", batch, http.StatusOK)
	if res["created"] != float64(2) || res["invalid"] != float64(1) || res["first_day"] == "" {
		t.Fatalf("import = %v", res)
	}
	list := e.json(http.MethodGet, "/v1/vocab?decision=learn", nil, http.StatusOK)["notes"].([]any)
	if len(list) != 2 || mapAt(list[0])["origin"] != "anki" {
		t.Fatalf("list = %v", list)
	}
	if again := e.json(http.MethodPost, "/v1/vocab/import", batch, http.StatusOK); again["created"] != float64(0) || again["duplicates"] != float64(2) {
		t.Fatalf("second import = %v", again)
	}
	big := make([]map[string]string, 201)
	for i := range big {
		big[i] = map[string]string{"term": "w" + strings.Repeat("x", i%5), "meaning": "m"}
	}
	if got := e.status(http.MethodPost, "/v1/vocab/import", map[string]any{"lang": "en", "notes": big}); got != http.StatusBadRequest {
		t.Fatalf("a batch of 201: %d", got)
	}
	// Paged: offset skips what was already read.
	page := e.json(http.MethodGet, "/v1/vocab?decision=learn&limit=1&offset=1", nil, http.StatusOK)["notes"].([]any)
	if len(page) != 1 || mapAt(page[0])["id"] == mapAt(list[0])["id"] {
		t.Fatalf("page 2 = %v", page)
	}
}
