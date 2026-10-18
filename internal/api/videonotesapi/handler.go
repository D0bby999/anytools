// Package videonotesapi is a YouTube video's study notes over HTTP. The
// caller's identity comes from httpx.MustUserID; the video is resolved with
// it, and another user's answers exactly like a missing one.
package videonotesapi

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/api/storageapi"
	"github.com/D0bby999/anytools/internal/capabilities/videonotes"
	"github.com/D0bby999/anytools/internal/runtime"
)

// Handler serves the study-notes routes.
type Handler struct {
	svc *videonotes.Service
	// drive saves exports to the learner's Drive; nil without Drive.
	drive *storageapi.Exports
}

// NewHandler builds the handler.
func NewHandler(svc *videonotes.Service) *Handler { return &Handler{svc: svc} }

// WithDriveExport enables "Save to my Drive" (drive-user-storage phase 2).
func (h *Handler) WithDriveExport(e *storageapi.Exports) *Handler {
	h.drive = e
	return h
}

// RegisterRoutes registers this package's patterns on the mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/documents/{id}/study-notes", h.list)
	mux.HandleFunc("POST /v1/documents/{id}/study-notes", h.generate) // budget: generate
	mux.HandleFunc("GET /v1/documents/{id}/study-notes/export", h.export)
	if h.drive != nil {
		mux.HandleFunc("POST /v1/documents/{id}/study-notes/export/drive", h.exportToDrive) // budget: upload
	}
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{
		"GET /v1/documents/{id}/study-notes",
		"POST /v1/documents/{id}/study-notes",
		"GET /v1/documents/{id}/study-notes/export",
		"POST /v1/documents/{id}/study-notes/export/drive",
	}
}

func docID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return uuid.Nil, false
	}
	return id, true
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	id, ok := docID(w, r)
	if !ok {
		return
	}
	list, err := h.svc.List(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"notes": list})
}

type generateRequest struct {
	// Language is a BCP 47 code; empty means the transcript's own.
	Language string `json:"language"`
}

func (h *Handler) generate(w http.ResponseWriter, r *http.Request) {
	id, ok := docID(w, r)
	if !ok {
		return
	}
	// An empty body is allowed: the language defaults to the transcript's.
	var req generateRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil && !errors.Is(err, io.EOF) {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	notes, err := h.svc.Generate(r.Context(), httpx.MustUserID(r.Context()), id, strings.TrimSpace(req.Language))
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, notes)
}

func (h *Handler) export(w http.ResponseWriter, r *http.Request) {
	id, ok := docID(w, r)
	if !ok {
		return
	}
	language := r.URL.Query().Get("language")
	doc, notes, err := h.svc.Get(r.Context(), httpx.MustUserID(r.Context()), id, language)
	if err != nil {
		fail(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+videonotes.ExportName(doc, language)+`"`)
	_, _ = w.Write([]byte(videonotes.Markdown(doc, notes)))
}

func fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, videonotes.ErrNotFound):
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
	case errors.Is(err, videonotes.ErrNoTranscript):
		httpx.WriteError(w, http.StatusConflict, "this video needs a transcript with times before it can have study notes", "no_transcript")
	case errors.Is(err, videonotes.ErrTooLong):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "study notes cover videos up to about three hours", "too_long")
	case errors.Is(err, videonotes.ErrBadLanguage):
		httpx.WriteError(w, http.StatusBadRequest, "that is not a language code", "bad_request")
	case errors.Is(err, videonotes.ErrInvalid):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "your model's notes could not be read — try again", "unreadable")
	case errors.Is(err, runtime.ErrNoProvider):
		httpx.WriteError(w, http.StatusConflict, "no reading model is configured — add one in Settings", "no_provider")
	case errors.Is(err, runtime.ErrProvider):
		httpx.WriteError(w, http.StatusBadGateway, "your model could not be reached", "provider_failed")
	default:
		slog.Error("videonotesapi: request failed", "path", r.URL.Path, "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
