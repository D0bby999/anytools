// Package photosapi is picking photos from Google Photos
// (learning-tool-connections phase 7).
package photosapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/connectors/googleapi"
	"github.com/D0bby999/anytools/internal/connectors/gphotos"
	"github.com/D0bby999/anytools/internal/rag/parse"
)

// Photos files picked photos as one photo document.
type Photos interface {
	OwnsKB(ctx context.Context, userID, kbID uuid.UUID) error
	UploadPhotos(ctx context.Context, userID, kbID uuid.UUID, photos []gphotos.Photo) (uuid.UUID, error)
}

// Handler serves the routes.
type Handler struct {
	svc    *gphotos.Service
	photos Photos
}

// NewHandler returns a Handler.
func NewHandler(svc *gphotos.Service, photos Photos) *Handler {
	return &Handler{svc: svc, photos: photos}
}

// RegisterRoutes attaches the routes.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/photos/sessions", h.start) // budget: none
	mux.HandleFunc("GET /v1/photos/sessions/{id}", h.poll)
	mux.HandleFunc("POST /v1/kb/{id}/photos/google", h.take) // budget: upload
}

// Patterns lists what RegisterRoutes registers.
func Patterns() []string {
	return []string{"POST /v1/photos/sessions", "GET /v1/photos/sessions/{id}", "POST /v1/kb/{id}/photos/google"}
}

func (h *Handler) start(w http.ResponseWriter, r *http.Request) {
	s, err := h.svc.Start(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s)
}

func (h *Handler) poll(w http.ResponseWriter, r *http.Request) {
	s, err := h.svc.Poll(r.Context(), httpx.MustUserID(r.Context()), r.PathValue("id"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s)
}

func (h *Handler) take(w http.ResponseWriter, r *http.Request) {
	user := httpx.MustUserID(r.Context())
	kbID, err := uuid.Parse(r.PathValue("id"))
	if err != nil || h.photos.OwnsKB(r.Context(), user, kbID) != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return
	}
	var body struct {
		SessionID string `json:"session_id"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	photos, err := h.svc.Take(r.Context(), user, body.SessionID, parse.MaxPhotoBytes)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if len(photos) == 0 {
		httpx.WriteError(w, http.StatusUnprocessableEntity, "no photo was picked", "no_photos")
		return
	}
	doc, err := h.photos.UploadPhotos(r.Context(), user, kbID, photos)
	if err != nil {
		httpx.WriteError(w, http.StatusUnprocessableEntity, err.Error(), "upload_refused")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"document_id": doc, "photos": len(photos), "kb_id": kbID})
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, gphotos.ErrNotReady):
		httpx.WriteError(w, http.StatusConflict, "nothing has been picked yet", "not_ready")
	case errors.Is(err, drive.ErrScopeMissing):
		httpx.WriteError(w, http.StatusConflict, "turn on Google Photos first", "scope_missing")
	case errors.Is(err, drive.ErrNotConnected):
		httpx.WriteError(w, http.StatusConflict, "Google is not connected for this account", "not_connected")
	case errors.Is(err, drive.ErrNeedsReconnect):
		httpx.WriteError(w, http.StatusConflict, "Google needs to be reconnected", "needs_reconnect")
	case googleapi.Disabled(err):
		httpx.WriteError(w, http.StatusServiceUnavailable, "the Google Photos Picker API is not enabled for this deployment", "api_disabled")
	case googleapi.IsStatus(err, http.StatusNotFound):
		httpx.WriteError(w, http.StatusNotFound, "that picking session has ended; start again", "session_gone")
	default:
		slog.Error("photosapi: request failed", "error", err, "path", r.URL.Path)
		httpx.WriteError(w, http.StatusBadGateway, "Google Photos did not answer as expected", "google_failed")
	}
}
