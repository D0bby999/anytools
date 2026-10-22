// Package showcaseapi serves learners' public profiles
// (the private design notes).
//
// Three routes are the learner's own page, behind RequireUser like
// everything else. Two are GATEWAY-ONLY, called by the BFF with the gateway
// bearer and no user: POST /v1/showcase/read, for a visitor to /u/<handle>,
// which only a published page answers; and POST /v1/showcase/listed, the
// published pages that may be indexed, for /sitemap.xml.
package showcaseapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/showcase"
)

// ReadPattern is the gateway-only route; httpx.GatewayOnlyPaths lists it.
const ReadPattern = "POST /v1/showcase/read"

// Handler serves /v1/showcase.
type Handler struct{ svc *showcase.Service }

// NewHandler builds a Handler.
func NewHandler(svc *showcase.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes registers the routes.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/showcase", h.get)
	mux.HandleFunc("PUT /v1/showcase", h.save)           // budget: social
	mux.HandleFunc("DELETE /v1/showcase", h.remove)      // budget: none
	mux.HandleFunc("POST /v1/showcase/read", h.read)     // budget: none (gateway-only)
	mux.HandleFunc("POST /v1/showcase/listed", h.listed) // budget: none (gateway-only)
}

// Patterns are the routes, for the server's allowlist.
func Patterns() []string {
	return []string{"GET /v1/showcase", "PUT /v1/showcase", "DELETE /v1/showcase", ReadPattern, "POST /v1/showcase/listed"}
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	mine, err := h.svc.Mine(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, mine)
}

func (h *Handler) save(w http.ResponseWriter, r *http.Request) {
	var in showcase.Input
	if err := httpx.DecodeJSON(w, r, &in); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	p, err := h.svc.Save(r.Context(), httpx.MustUserID(r.Context()), in)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, p)
}

func (h *Handler) remove(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.Delete(r.Context(), httpx.MustUserID(r.Context())); err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// read is a published page for a visitor. A handle with no page and one not
// published are the same 404.
func (h *Handler) read(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Handle string `json:"handle"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	page, err := h.svc.Read(r.Context(), body.Handle)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, page)
}

// listed is the sitemap's pages: handles and when each last changed, nothing
// else.
func (h *Handler) listed(w http.ResponseWriter, r *http.Request) {
	pages, err := h.svc.Listed(r.Context())
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"pages": pages})
}

func fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, showcase.ErrNotFound):
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
	case errors.Is(err, showcase.ErrHandleTaken):
		httpx.WriteError(w, http.StatusConflict, "that handle is taken; choose another", "handle_taken")
	case errors.Is(err, showcase.ErrInvalid):
		httpx.WriteError(w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), "showcase: invalid: "), "bad_request")
	default:
		slog.Error("showcaseapi: request failed", "error", err, "path", r.URL.Path, "method", r.Method)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
