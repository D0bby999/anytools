package libraryapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/D0bby999/anytools/internal/library"
)

// stubStore answers with what it was asked, to check how the query string
// is read and how errors become statuses.
type stubStore struct {
	loaded string
	got    library.Filter
}

func (s *stubStore) LoadedCatalogue(context.Context) (string, int, error) { return s.loaded, 1, nil }
func (s *stubStore) ReplaceCatalogue(context.Context, *library.Catalogue, bool) (bool, error) {
	return false, nil
}
func (s *stubStore) FindItems(_ context.Context, f library.Filter, _ int) (int, []library.Item, error) {
	s.got = f
	return 0, nil, nil
}
func (s *stubStore) FieldSamples(_ context.Context, f library.Filter, _ int) (int, []library.FieldGroup, error) {
	s.got = f
	return 0, nil, nil
}
func (s *stubStore) LibraryItem(_ context.Context, id string) (*library.Item, error) {
	if id != "mit:10.807/2.907/15.371+fall_2024" {
		return nil, library.ErrNotFound
	}
	return &library.Item{ID: id, Action: json.RawMessage(`{"type":"open"}`)}, nil
}
func (s *stubStore) CatalogueLanguages(context.Context) ([]string, error) { return []string{"en"}, nil }

func TestTheLibraryRoutes(t *testing.T) {
	store := &stubStore{loaded: "v"}
	mux := http.NewServeMux()
	NewHandler(library.NewService(store)).RegisterRoutes(mux)
	get := func(path string) (int, map[string]any) {
		t.Helper()
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		var body map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		return rec.Code, body
	}

	code, body := get("/v1/library/items?kind=course&subject=law&lang=all&ui=vi&q=+contract+&sort=rating&level=advanced&certificate=paid&video=1&reusable=1&offset=30")
	want := library.Filter{Kind: "course", Subject: "law", Lang: "all", UI: "vi", Q: "contract", Sort: "rating", Level: "advanced", Certificate: "paid", Video: true, Reusable: true, Offset: 30}
	if code != http.StatusOK || store.got != want {
		t.Fatalf("items: %d, read %+v", code, store.got)
	}
	if items, ok := body["items"].([]any); !ok || items == nil || body["languages"] == nil {
		t.Errorf("items is not a list: %v", body)
	}
	if code, body = get("/v1/library/fields?subject=law&q=x"); code != http.StatusOK || store.got.Subject != "" || store.got.Q != "" {
		t.Errorf("fields: %d, read %+v", code, store.got)
	} else if groups, ok := body["groups"].([]any); !ok || groups == nil {
		t.Errorf("groups is not a list: %v", body)
	}
	for _, bad := range []string{"sort=random", "kind=film", "certificate=gold", "offset=-5"} {
		if code, _ := get("/v1/library/items?" + bad); code != http.StatusBadRequest {
			t.Errorf("%s: %d", bad, code)
		}
	}
	// An id with slashes, as MIT's cross-listed courses have, reaches the store whole.
	if code, body := get("/v1/library/items/" + url.PathEscape("mit:10.807/2.907/15.371+fall_2024")); code != http.StatusOK || body["id"] != "mit:10.807/2.907/15.371+fall_2024" {
		t.Errorf("an id with slashes: %d %v", code, body)
	}
	if code, _ := get("/v1/library/items/nope"); code != http.StatusNotFound {
		t.Errorf("an unknown id: %d", code)
	}
	store.loaded = ""
	if code, body := get("/v1/library/fields"); code != http.StatusServiceUnavailable || body["code"] != "library_not_loaded" {
		t.Errorf("nothing loaded: %d %v", code, body)
	}
}
