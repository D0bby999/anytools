// Package gcalapi is the Google Calendar writer's HTTP surface
// (learning-tool-connections phase 3).
package gcalapi

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/connectors/gcal"
	"github.com/D0bby999/anytools/internal/connectors/googleapi"
)

// Handler serves the routes.
type Handler struct{ svc *gcal.Service }

// NewHandler returns a Handler.
func NewHandler(svc *gcal.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes attaches the routes.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/gcal", h.status)
	mux.HandleFunc("POST /v1/gcal/enable", h.enable)   // budget: none
	mux.HandleFunc("POST /v1/gcal/sync", h.sync)       // budget: none
	mux.HandleFunc("POST /v1/gcal/disable", h.disable) // budget: none
}

// Patterns lists what RegisterRoutes registers.
func Patterns() []string {
	return []string{"GET /v1/gcal", "POST /v1/gcal/enable", "POST /v1/gcal/sync", "POST /v1/gcal/disable"}
}

func (h *Handler) status(w http.ResponseWriter, r *http.Request) {
	l, err := h.svc.Status(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"link": l})
}

func (h *Handler) enable(w http.ResponseWriter, r *http.Request) {
	l, err := h.svc.Enable(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"link": l})
}

func (h *Handler) sync(w http.ResponseWriter, r *http.Request) {
	user := httpx.MustUserID(r.Context())
	if err := h.svc.Sync(r.Context(), user); err != nil {
		h.fail(w, r, err)
		return
	}
	h.status(w, r)
}

func (h *Handler) disable(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Remove bool `json:"remove"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	if err := h.svc.Disable(r.Context(), httpx.MustUserID(r.Context()), body.Remove); err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"link": nil})
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, gcal.ErrNotEnabled):
		httpx.WriteError(w, http.StatusConflict, "no AnyLearn calendar yet", "not_enabled")
	case errors.Is(err, drive.ErrScopeMissing):
		httpx.WriteError(w, http.StatusConflict, "turn on Google Calendar first", "scope_missing")
	case errors.Is(err, drive.ErrNotConnected):
		httpx.WriteError(w, http.StatusConflict, "Google is not connected for this account", "not_connected")
	case errors.Is(err, drive.ErrNeedsReconnect):
		httpx.WriteError(w, http.StatusConflict, "Google needs to be reconnected", "needs_reconnect")
	case googleapi.Disabled(err):
		httpx.WriteError(w, http.StatusServiceUnavailable, "the Google Calendar API is not enabled for this deployment", "api_disabled")
	default:
		slog.Error("gcalapi: request failed", "error", err, "path", r.URL.Path)
		httpx.WriteError(w, http.StatusBadGateway, "Google Calendar did not accept the change", "google_failed")
	}
}
