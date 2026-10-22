// Package progressapi serves a learner's progress: study days, streak,
// weekly goal, level, milestones and outcomes
// (the private design notes).
package progressapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/progress"
)

// Handler serves /v1/progress.
type Handler struct{ svc *progress.Service }

// NewHandler builds a Handler.
func NewHandler(svc *progress.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes registers the routes.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/progress", h.get)
	mux.HandleFunc("GET /v1/progress/brief", h.brief)
	mux.HandleFunc("PUT /v1/progress/settings", h.settings) // budget: none
}

// Patterns are the routes, for the server's allowlist.
func Patterns() []string {
	return []string{
		"GET /v1/progress",
		"GET /v1/progress/brief",
		"PUT /v1/progress/settings",
	}
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	sum, err := h.svc.Summary(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, sum)
}

// brief is Home's line: the streak, this week and the level, from a count a
// minute old at most.
func (h *Handler) brief(w http.ResponseWriter, r *http.Request) {
	b, err := h.svc.Brief(r.Context(), httpx.MustUserID(r.Context()), progress.FreshForHome)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, b)
}

func (h *Handler) settings(w http.ResponseWriter, r *http.Request) {
	var req progress.Settings
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	if err := h.svc.SetSettings(r.Context(), httpx.MustUserID(r.Context()), req); err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, req)
}

func fail(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, progress.ErrInvalid) {
		httpx.WriteError(w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), "progress: invalid: "), "bad_request")
		return
	}
	slog.Error("progressapi: request failed", "error", err, "path", r.URL.Path, "method", r.Method)
	httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
}
