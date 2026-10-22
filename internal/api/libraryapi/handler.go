// Package libraryapi is the Library's HTTP layer
// (the private design notes): one page of the catalogue, the
// first screen by field, and one item. The catalogue is the same for every
// learner, so nothing here reads or writes a user's rows; the routes are
// behind RequireUser all the same.
package libraryapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/library"
)

// Handler serves the Library routes.
type Handler struct{ svc *library.Service }

// NewHandler returns a Handler.
func NewHandler(svc *library.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes registers this package's patterns on the mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/library/items", h.items)
	mux.HandleFunc("GET /v1/library/fields", h.fields)
	mux.HandleFunc("GET /v1/library/items/{id}", h.item)
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{"GET /v1/library/items", "GET /v1/library/fields", "GET /v1/library/items/{id}"}
}

// filterOf reads the query string; Normalize checks the values.
func filterOf(r *http.Request) library.Filter {
	q := r.URL.Query()
	offset, _ := strconv.Atoi(q.Get("offset"))
	return library.Filter{
		Kind:        q.Get("kind"),
		Subject:     q.Get("subject"),
		Lang:        q.Get("lang"),
		Teaches:     q.Get("teaches"),
		UI:          q.Get("ui"),
		Q:           q.Get("q"),
		Sort:        q.Get("sort"),
		Level:       q.Get("level"),
		Certificate: q.Get("certificate"),
		Video:       q.Get("video") == "1",
		Reusable:    q.Get("reusable") == "1",
		Offset:      offset,
	}
}

func (h *Handler) items(w http.ResponseWriter, r *http.Request) {
	total, items, err := h.svc.Find(r.Context(), filterOf(r))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	langs, err := h.svc.Languages(r.Context())
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if items == nil {
		items = []library.Item{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"total": total, "items": items, "languages": langs})
}

func (h *Handler) fields(w http.ResponseWriter, r *http.Request) {
	total, groups, err := h.svc.Fields(r.Context(), filterOf(r))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	langs, err := h.svc.Languages(r.Context())
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if groups == nil {
		groups = []library.FieldGroup{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"total": total, "groups": groups, "languages": langs})
}

func (h *Handler) item(w http.ResponseWriter, r *http.Request) {
	it, err := h.svc.Item(r.Context(), r.PathValue("id"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, it)
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, library.ErrBadFilter):
		httpx.WriteError(w, http.StatusBadRequest, "that filter is not one the Library has", "bad_request")
	case errors.Is(err, library.ErrNotFound):
		httpx.WriteError(w, http.StatusNotFound, "the Library has no such item", "not_found")
	case errors.Is(err, library.ErrNotLoaded):
		httpx.WriteError(w, http.StatusServiceUnavailable, "the Library is still being loaded; try again in a minute", "library_not_loaded")
	default:
		slog.Error("libraryapi: request failed", "error", err, "path", r.URL.Path, "method", r.Method)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
