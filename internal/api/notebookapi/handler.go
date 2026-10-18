// Package notebookapi is the notebook's HTTP surface: notebooks, notes,
// categories, move/copy, and the Markdown export.
//
// The rule every handler here obeys, stated once: the caller's identity comes
// from httpx.MustUserID(ctx) and from nowhere else, and it is passed into the
// store, which filters on it in SQL. No handler takes a user id from a path, a
// query or a body. A row that does not belong to the caller is a 404 — never a
// 403 — because "you may not have this" and "this does not exist" must be
// indistinguishable or every id route is an existence oracle.
package notebookapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/api/storageapi"
	"github.com/D0bby999/anytools/internal/notebook"
)

// Handler serves the notebook routes.
type Handler struct {
	svc *notebook.Service
	// drive saves exports to the learner's Drive; nil without Drive.
	drive *storageapi.Exports
}

// NewHandler returns a Handler.
func NewHandler(svc *notebook.Service) *Handler { return &Handler{svc: svc} }

// WithDriveExport enables "Save to my Drive" (drive-user-storage phase 2).
func (h *Handler) WithDriveExport(e *storageapi.Exports) *Handler {
	h.drive = e
	return h
}

// RegisterRoutes registers this package's patterns on the mux.
//
// Every pattern must also appear in Patterns(), which api.RegisteredPatterns()
// folds in; a structural test greps both and fails in either direction, so a
// route cannot ship without the authentication test covering it.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/notebooks", h.listNotebooks)
	mux.HandleFunc("POST /v1/notebooks", h.createNotebook) // budget: none
	mux.HandleFunc("GET /v1/notebooks/{id}", h.getNotebook)
	mux.HandleFunc("PATCH /v1/notebooks/{id}", h.patchNotebook)   // budget: none
	mux.HandleFunc("DELETE /v1/notebooks/{id}", h.deleteNotebook) // budget: none
	mux.HandleFunc("GET /v1/notebooks/{id}/export.md", h.export)
	if h.drive != nil {
		mux.HandleFunc("POST /v1/notebooks/{id}/export/drive", h.exportToDrive) // budget: upload
	}

	mux.HandleFunc("GET /v1/notebooks/{id}/notes", h.listNotes)
	mux.HandleFunc("POST /v1/notebooks/{id}/notes", h.createNote) // budget: none
	mux.HandleFunc("GET /v1/notebooks/{id}/categories", h.listCategories)
	mux.HandleFunc("POST /v1/notebooks/{id}/categories", h.createCategory) // budget: none
	mux.HandleFunc("DELETE /v1/note-categories/{id}", h.deleteCategory)    // budget: none

	mux.HandleFunc("GET /v1/notes", h.searchNotes)
	mux.HandleFunc("GET /v1/notes/{id}", h.getNote)
	mux.HandleFunc("PATCH /v1/notes/{id}", h.patchNote)    // budget: none
	mux.HandleFunc("DELETE /v1/notes/{id}", h.deleteNote)  // budget: none
	mux.HandleFunc("POST /v1/notes/{id}/move", h.moveNote) // budget: none
	mux.HandleFunc("POST /v1/notes/{id}/copy", h.copyNote) // budget: none
}

// Patterns lists what RegisterRoutes registers.
func Patterns() []string {
	return []string{
		"GET /v1/notebooks",
		"POST /v1/notebooks",
		"GET /v1/notebooks/{id}",
		"PATCH /v1/notebooks/{id}",
		"DELETE /v1/notebooks/{id}",
		"GET /v1/notebooks/{id}/export.md",
		"POST /v1/notebooks/{id}/export/drive",
		"GET /v1/notebooks/{id}/notes",
		"POST /v1/notebooks/{id}/notes",
		"GET /v1/notebooks/{id}/categories",
		"POST /v1/notebooks/{id}/categories",
		"DELETE /v1/note-categories/{id}",
		"GET /v1/notes",
		"GET /v1/notes/{id}",
		"PATCH /v1/notes/{id}",
		"DELETE /v1/notes/{id}",
		"POST /v1/notes/{id}/move",
		"POST /v1/notes/{id}/copy",
	}
}

// ───────────────────────────────────────────────────────────────── notebooks

func (h *Handler) listNotebooks(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	books, err := h.svc.ListNotebooks(r.Context(), userID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"notebooks": books})
}

type nameRequest struct {
	Name string `json:"name"`
}

func (h *Handler) createNotebook(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	var req nameRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	nb, err := h.svc.CreateNotebook(r.Context(), userID, req.Name)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, nb)
}

func (h *Handler) getNotebook(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := ident(w, r)
	if !ok {
		return
	}
	nb, err := h.svc.GetNotebook(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, nb)
}

func (h *Handler) patchNotebook(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := ident(w, r)
	if !ok {
		return
	}
	var req nameRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	nb, err := h.svc.RenameNotebook(r.Context(), userID, id, req.Name)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, nb)
}

func (h *Handler) deleteNotebook(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := ident(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteNotebook(r.Context(), userID, id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ──────────────────────────────────────────────────────────────── categories

func (h *Handler) listCategories(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := ident(w, r)
	if !ok {
		return
	}
	// The notebook is read first so a foreign id is a 404 rather than an empty
	// list, which would confirm the id exists by not erroring.
	if _, err := h.svc.GetNotebook(r.Context(), userID, id); err != nil {
		h.fail(w, r, err)
		return
	}
	cats, err := h.svc.ListCategories(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"categories": cats})
}

func (h *Handler) createCategory(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := ident(w, r)
	if !ok {
		return
	}
	if _, err := h.svc.GetNotebook(r.Context(), userID, id); err != nil {
		h.fail(w, r, err)
		return
	}
	var req nameRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	cat, err := h.svc.CreateCategory(r.Context(), userID, id, req.Name)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, cat)
}

func (h *Handler) deleteCategory(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := ident(w, r)
	if !ok {
		return
	}
	if err := h.svc.DeleteCategory(r.Context(), userID, id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─────────────────────────────────────────────────────────────── internals

// ident reads the caller and the `{id}` path value together.
//
// A malformed id is answered exactly like an unowned one — 404, not 400 —
// because anything else tells a prober which of their guesses were
// syntactically interesting.
func ident(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
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

func limitParam(r *http.Request, def int) int {
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

// fail maps an error to a response.
//
// notebook.ErrInvalid carries a sentence written for a person and is the only
// error whose text reaches the client. Anything else goes to the log with its
// path and comes back as one word, because a database error string reaching the
// browser through the BFF is an internals leak.
func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, notebook.ErrNotFound):
		notFound(w)
	case errors.Is(err, notebook.ErrInvalid):
		badRequest(w, strings.TrimPrefix(err.Error(), "notebook: invalid: "))
	default:
		slog.Error("notebookapi: request failed", "error", err, "path", r.URL.Path, "method", r.Method)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
