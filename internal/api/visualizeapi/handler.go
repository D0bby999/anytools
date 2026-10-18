// Package visualizeapi is "Draw it" over HTTP (learning-depth phase 5).
//
// The caller's identity comes from httpx.MustUserID and nowhere else; every
// id in a request is resolved with it by the service, and a foreign id answers
// exactly like a missing one.
package visualizeapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/capabilities/visualize"
	"github.com/D0bby999/anytools/internal/runtime"
)

// Handler serves the visualize routes.
type Handler struct{ svc *visualize.Service }

// NewHandler builds the handler.
func NewHandler(svc *visualize.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes registers this package's patterns on the mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/visualize", h.draw)               // budget: generate
	mux.HandleFunc("POST /v1/visualize/{id}/repair", h.repair) // budget: generate
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{"POST /v1/visualize", "POST /v1/visualize/{id}/repair"}
}

type drawRequest struct {
	MessageID string `json:"message_id"`
	Request   string `json:"request"`
}

// draw draws one of the caller's assistant messages (a chat answer, a
// solution, a reading tutor's answer) and appends the diagram after it.
func (h *Handler) draw(w http.ResponseWriter, r *http.Request) {
	var req drawRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	id, err := uuid.Parse(strings.TrimSpace(req.MessageID))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return
	}
	res, err := h.svc.DrawMessage(r.Context(), httpx.MustUserID(r.Context()), id, req.Request)
	if err != nil {
		Fail(w, r, err)
		return
	}
	Write(w, http.StatusCreated, res)
}

type repairRequest struct {
	Error string `json:"error"`
}

// repair fixes a diagram the browser could not draw. Once per diagram.
func (h *Handler) repair(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return
	}
	var req repairRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	res, err := h.svc.Repair(r.Context(), httpx.MustUserID(r.Context()), id, req.Error)
	if err != nil {
		Fail(w, r, err)
		return
	}
	Write(w, http.StatusOK, res)
}

// Write answers with the diagram message, in the shape the chat transcript
// uses for any message.
func Write(w http.ResponseWriter, status int, res *visualize.Result) {
	httpx.WriteJSON(w, status, map[string]any{
		"message": map[string]any{
			"id":         res.Message.ID,
			"session_id": res.Message.SessionID,
			"role":       res.Message.Role,
			"content":    res.Message.Content,
			"capability": res.Message.Capability,
			"created_at": res.Message.CreatedAt,
		},
		"diagram": res.Diagram,
	})
}

// Fail maps the service's errors. Shared with readingapi's selection route.
func Fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, visualize.ErrNotFound):
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
	case errors.Is(err, visualize.ErrRepaired):
		httpx.WriteError(w, http.StatusConflict, "this diagram has already been repaired once", "already_repaired")
	case errors.Is(err, visualize.ErrBadRequest):
		httpx.WriteError(w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), "visualize: bad request: "), "bad_request")
	case errors.Is(err, visualize.ErrInvalid):
		httpx.WriteError(w, http.StatusUnprocessableEntity,
			"your model could not draw this as a diagram — try asking for a different kind", "not_drawable")
	case errors.Is(err, runtime.ErrNoProvider):
		httpx.WriteError(w, http.StatusConflict, "no model is configured for this — add one in Settings", "no_provider")
	case errors.Is(err, runtime.ErrProvider):
		httpx.WriteError(w, http.StatusBadGateway, "your model could not be reached", "provider_failed")
	default:
		slog.Error("visualizeapi: request failed", "path", r.URL.Path, "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
