package vocabapi

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/connectors/wordsources"
)

// lookups.go: example sentences and recorded pronunciations from open
// sources for a saved word (the private design notes, phase
// 6), and a sentence taken from them. The lookups call Tatoeba, Wikimedia
// Commons and the Free Dictionary API from the server, so they are their own
// route class ("lookup"); taking a sentence is a write like any other.

// WithWordSources gives the handler its lookups; without them the lookup
// routes answer 503.
func (h *Handler) WithWordSources(c *wordsources.Client) *Handler {
	h.words = c
	return h
}

func (h *Handler) registerLookups(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/vocab/lookup/sentences", h.lookupSentences)   // budget: lookup
	mux.HandleFunc("GET /v1/vocab/lookup/recordings", h.lookupRecordings) // budget: lookup
	mux.HandleFunc("GET /v1/vocab/lookup/audio", h.lookupAudio)           // budget: lookup
	mux.HandleFunc("POST /v1/vocab/{id}/sentence", h.addSentence)         // budget: none
}

func lookupPatterns() []string {
	return []string{
		"GET /v1/vocab/lookup/sentences",
		"GET /v1/vocab/lookup/recordings",
		"GET /v1/vocab/lookup/audio",
		"POST /v1/vocab/{id}/sentence",
	}
}

// lookupFail answers a source that did not answer as 502, so the page says
// the source is down rather than that the word has nothing.
func lookupFail(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, wordsources.ErrUnavailable) {
		slog.Warn("vocabapi: word source unavailable", "error", err, "path", r.URL.Path)
		httpx.WriteError(w, http.StatusBadGateway, "the source did not answer; try again later", "source_unavailable")
		return
	}
	slog.Error("vocabapi: lookup failed", "error", err, "path", r.URL.Path)
	httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
}

func (h *Handler) lookupReady(w http.ResponseWriter) bool {
	if h.words == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "word lookups are off on this server", "unavailable")
		return false
	}
	return true
}

// lookupSentences is Tatoeba's sentences with ?term= in ?lang=, translated into ?to=.
func (h *Handler) lookupSentences(w http.ResponseWriter, r *http.Request) {
	if !h.lookupReady(w) {
		return
	}
	q := r.URL.Query()
	out, err := h.words.Sentences(r.Context(), q.Get("lang"), q.Get("term"), q.Get("to"))
	if err != nil {
		lookupFail(w, r, err)
		return
	}
	if out == nil {
		out = []wordsources.Sentence{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"sentences": out})
}

// lookupRecordings is people saying ?term= in ?lang=.
func (h *Handler) lookupRecordings(w http.ResponseWriter, r *http.Request) {
	if !h.lookupReady(w) {
		return
	}
	q := r.URL.Query()
	out, err := h.words.Recordings(r.Context(), q.Get("lang"), q.Get("term"))
	if err != nil {
		lookupFail(w, r, err)
		return
	}
	if out == nil {
		out = []wordsources.Recording{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"recordings": out})
}

// lookupAudio sends on a recording's sound, by the id lookupRecordings gave.
func (h *Handler) lookupAudio(w http.ResponseWriter, r *http.Request) {
	if !h.lookupReady(w) {
		return
	}
	body, ct, err := h.words.Audio(r.Context(), r.URL.Query().Get("id"))
	if errors.Is(err, wordsources.ErrNotARecording) {
		notFound(w)
		return
	}
	if err != nil {
		lookupFail(w, r, err)
		return
	}
	defer body.Close()
	w.Header().Set("Content-Type", ct)
	// The same id is the same file: a day in the browser's cache.
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if _, err := io.Copy(w, body); err != nil {
		slog.Warn("vocabapi: audio cut short", "error", err)
	}
}

type sentenceRequest struct {
	Sentence string `json:"sentence"`
	Credit   string `json:"credit"`
	URL      string `json:"url"`
}

// addSentence takes a sentence from a source for the caller's word.
func (h *Handler) addSentence(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req sentenceRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	note, err := h.svc.AddSentence(r.Context(), userID, id, req.Sentence, strings.TrimSpace(req.Credit), req.URL)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, note)
}
