package httpx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func serveLocalized(lang string, h http.HandlerFunc) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(WithLanguage(req.Context(), lang))
	rec := httptest.NewRecorder()
	Localize(h).ServeHTTP(rec, req)
	return rec
}

func TestLocalizeTranslatesErrorSentencesAndLeavesCodes(t *testing.T) {
	rec := serveLocalized("vi", func(w http.ResponseWriter, _ *http.Request) {
		WriteError(w, http.StatusNotFound, "not found", "not_found")
	})
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"error":"không tìm thấy"`) ||
		!strings.Contains(rec.Body.String(), `"code":"not_found"`) {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}

	// A stored failure inside a list, a sync error beside it, a code in an
	// "error" field and a sentence under any other key.
	rec = serveLocalized("es", func(w http.ResponseWriter, _ *http.Request) {
		WriteJSON(w, http.StatusOK, map[string]any{"documents": []any{map[string]any{
			"id": 9007199254740993, "error": "no readable text was found in this document",
			"sync_error": "the site could not be reached", "title": "not found",
		}}, "moves": []any{map[string]any{"error": "drive_full"}}})
	})
	body := rec.Body.String()
	for _, want := range []string{
		`"error":"no se encontró texto legible en este documento"`,
		`"sync_error":"no se pudo contactar con el sitio"`,
		`"title":"not found"`, `"error":"drive_full"`, `"id":9007199254740993`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("missing %s in %s", want, body)
		}
	}
}

func TestLocalizeLeavesEnglishAndStreamsAlone(t *testing.T) {
	rec := serveLocalized("en", func(w http.ResponseWriter, _ *http.Request) {
		WriteError(w, http.StatusNotFound, "not found", "not_found")
	})
	if !strings.Contains(rec.Body.String(), `"error":"not found"`) {
		t.Fatalf("English changed: %s", rec.Body)
	}

	rec = serveLocalized("pt", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"error\":\"not found\"}\n\n"))
		w.(http.Flusher).Flush()
	})
	if !rec.Flushed || rec.Body.String() != "data: {\"error\":\"not found\"}\n\n" {
		t.Fatalf("stream was buffered or rewritten: flushed=%v %q", rec.Flushed, rec.Body)
	}
}
