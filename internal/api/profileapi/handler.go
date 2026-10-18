// Package profileapi is the learner profile's HTTP layer: the entries, the
// proposals the nightly consolidation writes, its on/off switch, and its runs.
//
// None of these routes calls a model — consolidation runs at night, on the
// learner's key, only when they have turned it on — so every write is
// `budget: none`.
//
// Identity comes from httpx.MustUserID(ctx) and nowhere else. Every id is
// resolved with the caller's user_id, and "not yours" and "no such thing" are
// the same 404.
package profileapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/learning/profile"
)

// Handler serves the profile routes.
type Handler struct{ svc *profile.Service }

// NewHandler returns a Handler.
func NewHandler(svc *profile.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes registers this package's patterns on the mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/profile", h.get)
	mux.HandleFunc("DELETE /v1/profile", h.clear)                    // budget: none
	mux.HandleFunc("PUT /v1/profile/settings", h.settings)           // budget: none
	mux.HandleFunc("POST /v1/profile/entries", h.create)             // budget: none
	mux.HandleFunc("PATCH /v1/profile/entries/{id}", h.patch)        // budget: none
	mux.HandleFunc("DELETE /v1/profile/entries/{id}", h.remove)      // budget: none
	mux.HandleFunc("POST /v1/profile/entries/{id}/accept", h.accept) // budget: none
	mux.HandleFunc("POST /v1/profile/entries/{id}/reject", h.reject) // budget: none
	mux.HandleFunc("GET /v1/profile/runs", h.runs)
	mux.HandleFunc("GET /v1/profile/runs/{id}", h.run)
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{
		"GET /v1/profile",
		"DELETE /v1/profile",
		"PUT /v1/profile/settings",
		"POST /v1/profile/entries",
		"PATCH /v1/profile/entries/{id}",
		"DELETE /v1/profile/entries/{id}",
		"POST /v1/profile/entries/{id}/accept",
		"POST /v1/profile/entries/{id}/reject",
		"GET /v1/profile/runs",
		"GET /v1/profile/runs/{id}",
	}
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	p, err := h.svc.Get(r.Context(), userID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, p)
}

func (h *Handler) clear(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	n, err := h.svc.Clear(r.Context(), userID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"removed": n})
}

type settingsRequest struct {
	Consolidation *bool `json:"consolidation"`
}

func (h *Handler) settings(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req settingsRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil || req.Consolidation == nil {
		badRequest(w, "consolidation must be true or false")
		return
	}
	if err := h.svc.SetConsolidation(r.Context(), userID, *req.Consolidation); err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"consolidation": *req.Consolidation})
}

type createEntryRequest struct {
	Section string `json:"section"`
	Text    string `json:"text"`
	// KBID scopes the entry to one of the learner's knowledge bases; empty
	// for none.
	KBID string `json:"kb_id"`
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req createEntryRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	kbID, ok := optionalID(w, req.KBID)
	if !ok {
		return
	}
	e, err := h.svc.Add(r.Context(), userID, req.Section, req.Text, kbID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, e)
}

type patchEntryRequest struct {
	Section *string `json:"section"`
	Text    *string `json:"text"`
	// KBID: absent keeps the scope, "" clears it, an id sets it.
	KBID *string `json:"kb_id"`
}

func (h *Handler) patch(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req patchEntryRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	patch := profile.EntryPatch{Section: req.Section, Text: req.Text}
	if req.KBID != nil {
		kbID, ok := optionalID(w, *req.KBID)
		if !ok {
			return
		}
		if kbID == nil {
			none := uuid.Nil
			kbID = &none
		}
		patch.KBID = kbID
	}
	e, err := h.svc.Edit(r.Context(), userID, id, patch)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, e)
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

func (h *Handler) accept(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	e, err := h.svc.Accept(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, e)
}

func (h *Handler) reject(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	e, err := h.svc.Reject(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, e)
}

func (h *Handler) runs(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	runs, err := h.svc.Runs(r.Context(), userID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"runs": runs})
}

func (h *Handler) run(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := pathID(w, r)
	if !ok {
		return
	}
	run, err := h.svc.Run(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, run)
}

// optionalID parses a knowledge-base id from a body: "" is none, and a
// malformed one is the same 404 as another user's.
func optionalID(w http.ResponseWriter, raw string) (*uuid.UUID, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, true
	}
	id, err := uuid.Parse(raw)
	if err != nil || id == uuid.Nil {
		notFound(w)
		return nil, false
	}
	return &id, true
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

func notFound(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
}

func badRequest(w http.ResponseWriter, msg string) {
	httpx.WriteError(w, http.StatusBadRequest, msg, "bad_request")
}

// fail maps an error to a response. Only the profile's own sentences reach
// the client; anything else is logged and answered with one word.
func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, profile.ErrNotFound):
		notFound(w)
	case errors.Is(err, profile.ErrInvalid):
		badRequest(w, strings.TrimPrefix(err.Error(), "profile: invalid: "))
	case errors.Is(err, profile.ErrSectionFull):
		httpx.WriteError(w, http.StatusConflict, "this section already holds 12 entries", "section_full")
	case errors.Is(err, profile.ErrConflict):
		httpx.WriteError(w, http.StatusConflict, strings.TrimPrefix(err.Error(), "profile: conflict: "), "conflict")
	default:
		slog.Error("profileapi: request failed", "error", err, "path", r.URL.Path, "method", r.Method)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
