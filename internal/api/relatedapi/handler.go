// Package relatedapi is a knowledge base's related papers over HTTP
// (learning-depth phase 6). The caller's identity comes from
// httpx.MustUserID; the knowledge base is resolved with it, and another
// user's answers exactly like a missing one.
package relatedapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/capabilities/related"
	"github.com/D0bby999/anytools/internal/rag/papers"
	"github.com/D0bby999/anytools/internal/tools"
)

// Handler serves the related-papers routes.
type Handler struct{ svc *related.Service }

// NewHandler builds the handler.
func NewHandler(svc *related.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes registers this package's patterns on the mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/kb/{id}/related-papers", h.list) // budget: generate
	mux.HandleFunc("POST /v1/kb/{id}/papers", h.add)         // budget: upload
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{"GET /v1/kb/{id}/related-papers", "POST /v1/kb/{id}/papers"}
}

func kbID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return uuid.Nil, false
	}
	return id, true
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	id, ok := kbID(w, r)
	if !ok {
		return
	}
	list, err := h.svc.Related(r.Context(), httpx.MustUserID(r.Context()), id, r.URL.Query().Get("focus"))
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, list)
}

type addRequest struct {
	// OpenAlexID names the work; the server reads everything else itself.
	OpenAlexID string `json:"openalex_id"`
}

func (h *Handler) add(w http.ResponseWriter, r *http.Request) {
	id, ok := kbID(w, r)
	if !ok {
		return
	}
	var req addRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	added, err := h.svc.Add(r.Context(), httpx.MustUserID(r.Context()), id, strings.TrimSpace(req.OpenAlexID))
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, added)
}

func fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, related.ErrNotFound):
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
	case errors.Is(err, related.ErrAlreadyAdded):
		httpx.WriteError(w, http.StatusConflict, "this paper is already in the knowledge base", "already_added")
	case errors.Is(err, related.ErrTooManyFocuses):
		httpx.WriteError(w, http.StatusTooManyRequests,
			"five different focuses a day per knowledge base — try one you have used today", "focus_limit")
	case errors.Is(err, tools.ErrPaperBudget), errors.Is(err, papers.ErrLimited):
		httpx.WriteError(w, http.StatusTooManyRequests,
			"the free daily budget for paper searches is used up; add a free OpenAlex key in Settings → Search keys", "paper_budget")
	case strings.Contains(err.Error(), "is not an OpenAlex work id"):
		httpx.WriteError(w, http.StatusBadRequest, "that is not an OpenAlex work id", "bad_request")
	default:
		var pe *papers.Error
		if errors.As(err, &pe) {
			httpx.WriteError(w, http.StatusBadGateway, "the paper service could not be reached — try again later", "papers_unavailable")
			return
		}
		slog.Error("relatedapi: request failed", "path", r.URL.Path, "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
