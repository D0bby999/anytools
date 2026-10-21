// Package vocabapi is the vocabulary's HTTP layer: saving a word from a
// reading selection, the word list, and the spaced review of its cards.
//
// None of these routes calls a model — the meaning a word is saved with came
// from "Find words to save" (readingapi, budget: generate) or from the
// learner — so all of them are `budget: none`.
//
// Identity comes from httpx.MustUserID(ctx) and nowhere else. Every id is
// resolved with the caller's user_id, and "not yours" and "no such thing" are
// the same 404.
package vocabapi

import (
	"cmp"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/connectors/wordsources"
	"github.com/D0bby999/anytools/internal/vocab"
)

// Handler serves the vocabulary routes.
type Handler struct {
	svc   *vocab.Service
	words *wordsources.Client
}

// NewHandler returns a Handler.
func NewHandler(svc *vocab.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes registers this package's patterns on the mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/vocab", h.list)
	mux.HandleFunc("POST /v1/vocab", h.save) // budget: none
	// `due` is more specific than `{id}`, so the mux never reads it as an id.
	mux.HandleFunc("GET /v1/vocab/due", h.due)
	mux.HandleFunc("PATCH /v1/vocab/{id}", h.patch)              // budget: none
	mux.HandleFunc("DELETE /v1/vocab/{id}", h.remove)            // budget: none
	mux.HandleFunc("POST /v1/vocab/cards/{id}/review", h.review) // budget: none
	// up-methods phase 3: "Practise using it", the production card.
	mux.HandleFunc("POST /v1/vocab/{id}/production", h.production) // budget: none
	// the private design notes, phase 3: an Anki deck's words, in batches.
	mux.HandleFunc("POST /v1/vocab/import", h.importDeck) // budget: upload
	// the private design notes, phase 1: the Languages tabs.
	mux.HandleFunc("GET /v1/vocab/languages", h.languages)
	mux.HandleFunc("PUT /v1/vocab/languages", h.setLanguages) // budget: none
	// the private design notes, phase 5: general decks.
	h.registerDecks(mux)
	// the private design notes, phase 6: sentences and recordings.
	h.registerLookups(mux)
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return append([]string{
		"GET /v1/vocab",
		"POST /v1/vocab",
		"GET /v1/vocab/due",
		"PATCH /v1/vocab/{id}",
		"DELETE /v1/vocab/{id}",
		"POST /v1/vocab/cards/{id}/review",
		"POST /v1/vocab/{id}/production",
		"POST /v1/vocab/import",
		"GET /v1/vocab/languages",
		"PUT /v1/vocab/languages",
	}, append(deckPatterns(), lookupPatterns()...)...)
}

type importRequest struct {
	Lang string `json:"lang"`
	// Origin: empty for an Anki deck, or a library list's "library:<list>-<level>".
	Origin string             `json:"origin"`
	Notes  []vocab.ImportNote `json:"notes"`
}

// importDeck saves one batch of a deck the page read and mapped.
func (h *Handler) importDeck(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req importRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	res, err := h.svc.ImportFrom(r.Context(), userID, req.Lang, cmp.Or(req.Origin, vocab.OriginAnki), req.Notes)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, res)
}

type saveRequest struct {
	WorkspaceID string `json:"workspace_id"`
	Page        int    `json:"page"`
	Selection   string `json:"selection"`
	Term        string `json:"term"`
	Meaning     string `json:"meaning"`
	Lang        string `json:"lang"`
	Reading     string `json:"reading"`
	POS         string `json:"pos"`
	// up-methods phase 3: one of the five decisions and its minimum record.
	// Absent is a client from before decisions: a word to learn.
	Decision   string            `json:"decision"`
	Record     map[string]string `json:"record"`
	TaskImpact string            `json:"task_impact"`
}

// save stores a word from a reading selection. 201 for a new note, 200 when
// the word was already saved and this added a context to it. A second save
// never changes the decision: the note comes back with the one it has, and
// the picker offers to change it (PATCH). A new word to learn comes back
// with the learner's count for the week.
func (h *Handler) save(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req saveRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	wsID, err := uuid.Parse(strings.TrimSpace(req.WorkspaceID))
	if err != nil || wsID == uuid.Nil {
		// The same answer as another user's workspace.
		notFound(w)
		return
	}
	note, created, err := h.svc.Save(r.Context(), userID, vocab.SaveInput{
		WorkspaceID: wsID, Page: req.Page, Selection: req.Selection,
		Term: req.Term, Meaning: req.Meaning, Lang: req.Lang, Reading: req.Reading, POS: req.POS,
		Decision: req.Decision, Record: req.Record, TaskImpact: req.TaskImpact,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	body := map[string]any{"note": note, "created": created}
	if created && note.Decision == vocab.DecisionLearn {
		if body["week"], err = h.svc.Week(r.Context(), userID); err != nil {
			h.fail(w, r, err)
			return
		}
	}
	httpx.WriteJSON(w, status, body)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	q := r.URL.Query()
	notes, err := h.svc.List(r.Context(), userID, vocab.Filter{
		Q: q.Get("q"), Lang: q.Get("lang"), Limit: intParam(r, "limit", 200), Offset: intParam(r, "offset", 0),
		Decision: q.Get("decision"), Terms: q["term"],
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"notes": notes})
}

// due is today's session: at most vocab.SessionSize cards, oldest first, and
// the number due in all. `?limit=0` returns the count alone, for Home;
// `?lang=ja` only that language's words, for a Languages tab.
// `?deck=book` is the living books' flash cards (learning-depth phase 11);
// the default is the words, which never include them.
func (h *Handler) due(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	deck := r.URL.Query().Get("deck")
	if deck == "" {
		deck = vocab.DeckWords
	}
	cards, total, err := h.svc.DueIn(r.Context(), userID, deck, r.URL.Query().Get("lang"), intParam(r, "limit", vocab.SessionSize))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"cards": cards, "due_count": total})
}

type patchRequest struct {
	Meaning   *string `json:"meaning"`
	Reading   *string `json:"reading"`
	POS       *string `json:"pos"`
	Lang      *string `json:"lang"`
	Suspended *bool   `json:"suspended"`
	// up-methods phase 3.
	Decision   *string           `json:"decision"`
	Record     map[string]string `json:"record"`
	TaskImpact *string           `json:"task_impact"`
	Scenario   *string           `json:"scenario"`
	Confusable *string           `json:"confusable"`
	Production *bool             `json:"production"`
	// The listening card (the private design notes, phase 1).
	Listening *bool `json:"listening"`
	// The writing card (the private design notes, phase 3).
	Writing *bool `json:"writing"`
}

// patchResponse is the note, and, when this patch made it a word to learn,
// the learner's count for the week beside its fields.
type patchResponse struct {
	*vocab.Note
	Week *vocab.Week `json:"week,omitempty"`
}

func (h *Handler) patch(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req patchRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	note, err := h.svc.Update(r.Context(), userID, id, vocab.NotePatch{
		Meaning: req.Meaning, Reading: req.Reading, POS: req.POS, Lang: req.Lang, Suspended: req.Suspended,
		Decision: req.Decision, Record: req.Record, TaskImpact: req.TaskImpact,
		Scenario: req.Scenario, Confusable: req.Confusable, Production: req.Production,
		Listening: req.Listening,
		Writing:   req.Writing,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	resp := patchResponse{Note: note}
	if req.Decision != nil && note.Decision == vocab.DecisionLearn {
		week, err := h.svc.Week(r.Context(), userID)
		if err != nil {
			h.fail(w, r, err)
			return
		}
		resp.Week = &week
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}

type productionRequest struct {
	Scenario   string `json:"scenario"`
	Confusable string `json:"confusable"`
}

// production is "Practise using it": the learner's own scenario, and the
// production card created (or resumed) on a word being learned. Turning it
// off is PATCH {"production": false}, which suspends the card.
func (h *Handler) production(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req productionRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	note, err := h.svc.Practise(r.Context(), userID, id, req.Scenario, req.Confusable)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, note)
}

func (h *Handler) remove(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), userID, id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type reviewRequest struct {
	Rating string `json:"rating"`
	Answer string `json:"answer"`
	// RequestID is the client's idempotency key, not a row: it is unique per
	// user in vocab_reviews, so a repeat returns the first result.
	RequestID string `json:"request_id"`
}

func (h *Handler) review(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req reviewRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	requestID, err := uuid.Parse(strings.TrimSpace(req.RequestID))
	if err != nil {
		badRequest(w, "request_id must be a uuid")
		return
	}
	res, err := h.svc.Review(r.Context(), userID, id, vocab.ReviewInput{
		Rating: strings.TrimSpace(req.Rating), Answer: req.Answer, RequestID: requestID,
	})
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, res)
}

// pathID reads the caller and the `{id}` path value. A malformed id is the
// same 404 as another user's.
func pathID(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	userID := httpx.MustUserID(r.Context())
	id, err := uuid.Parse(strings.TrimSpace(r.PathValue("id")))
	if err != nil || id == uuid.Nil {
		notFound(w)
		return uuid.Nil, uuid.Nil, false
	}
	return userID, id, true
}

func intParam(r *http.Request, name string, def int) int {
	if v := r.URL.Query().Get(name); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			return n
		}
	}
	return def
}

func notFound(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
}

func badRequest(w http.ResponseWriter, msg string) {
	httpx.WriteError(w, http.StatusBadRequest, msg, "bad_request")
}

// fail maps an error to a response. Only vocab.ErrInvalid's sentences reach
// the client; anything else is logged and answered with one word.
func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, vocab.ErrNotFound):
		notFound(w)
	case errors.Is(err, vocab.ErrNoText):
		httpx.WriteError(w, http.StatusConflict, "this document has not been parsed yet", "not_ready")
	case errors.Is(err, vocab.ErrInvalid):
		badRequest(w, strings.TrimPrefix(err.Error(), "vocab: invalid: "))
	default:
		slog.Error("vocabapi: request failed", "error", err, "path", r.URL.Path, "method", r.Method)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}

// languages is the learner's studied languages and their words' languages.
func (h *Handler) languages(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Languages(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// setLanguages replaces the studied list and the tab viewed last.
func (h *Handler) setLanguages(w http.ResponseWriter, r *http.Request) {
	var req vocab.Studied
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	out, err := h.svc.SetLanguages(r.Context(), httpx.MustUserID(r.Context()), req)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}
