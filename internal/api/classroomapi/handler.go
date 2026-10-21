// Package classroomapi is Google Classroom in AnyLearn
// (learning-tool-connections phase 6).
package classroomapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/connectors/classroom"
	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/connectors/googleapi"
)

// Handler serves the routes.
type Handler struct{ svc *classroom.Service }

// NewHandler returns a Handler.
func NewHandler(svc *classroom.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes attaches the routes.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/classroom/courses", h.courses)
	mux.HandleFunc("GET /v1/classroom/courses/{id}/items", h.items)
	mux.HandleFunc("POST /v1/classroom/courses/{id}/link", h.link)          // budget: none
	mux.HandleFunc("POST /v1/classroom/courses/{id}/import", h.importItems) // budget: upload
	mux.HandleFunc("POST /v1/classroom/courses/{id}/seen", h.seen)          // budget: none
}

// Patterns lists what RegisterRoutes registers.
func Patterns() []string {
	return []string{
		"GET /v1/classroom/courses", "GET /v1/classroom/courses/{id}/items",
		"POST /v1/classroom/courses/{id}/link", "POST /v1/classroom/courses/{id}/import",
		"POST /v1/classroom/courses/{id}/seen",
	}
}

func (h *Handler) courses(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Courses(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if out == nil {
		out = []classroom.Course{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"courses": out})
}

func (h *Handler) items(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Items(r.Context(), httpx.MustUserID(r.Context()), r.PathValue("id"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if out == nil {
		out = []classroom.Item{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (h *Handler) link(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
		KBID string `json:"kb_id"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	var kb *uuid.UUID
	if strings.TrimSpace(body.KBID) != "" {
		id, err := uuid.Parse(body.KBID)
		if err != nil {
			httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
			return
		}
		kb = &id
	}
	l, err := h.svc.LinkCourse(r.Context(), httpx.MustUserID(r.Context()), r.PathValue("id"), body.Name, kb)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"kb_id": l.KBID})
}

func (h *Handler) importItems(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Keys []string `json:"keys"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil || len(body.Keys) == 0 || len(body.Keys) > 500 {
		httpx.WriteError(w, http.StatusBadRequest, "choose what to import", "bad_request")
		return
	}
	rep, err := h.svc.Import(r.Context(), httpx.MustUserID(r.Context()), r.PathValue("id"), body.Keys)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, rep)
}

func (h *Handler) seen(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FileIDs []string `json:"file_ids"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil || len(body.FileIDs) > 500 {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	if err := h.svc.MarkSeen(r.Context(), httpx.MustUserID(r.Context()), r.PathValue("id"), body.FileIDs); err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, classroom.ErrSchoolBlocked):
		httpx.WriteError(w, http.StatusForbidden, "this school's Google administrator has not allowed AnyLearn", "school_blocked")
	case errors.Is(err, classroom.ErrNotLinked):
		httpx.WriteError(w, http.StatusConflict, "link this class to a knowledge base first", "not_linked")
	case errors.Is(err, authz.ErrNoAccess):
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
	case errors.Is(err, drive.ErrScopeMissing):
		httpx.WriteError(w, http.StatusConflict, "turn on Google Classroom first", "scope_missing")
	case errors.Is(err, drive.ErrNotConnected):
		httpx.WriteError(w, http.StatusConflict, "Google is not connected for this account", "not_connected")
	case errors.Is(err, drive.ErrNeedsReconnect):
		httpx.WriteError(w, http.StatusConflict, "Google needs to be reconnected", "needs_reconnect")
	case googleapi.Disabled(err):
		httpx.WriteError(w, http.StatusServiceUnavailable, "the Google Classroom API is not enabled for this deployment", "api_disabled")
	case googleapi.IsStatus(err, http.StatusNotFound):
		httpx.WriteError(w, http.StatusNotFound, "that class was not found", "not_found")
	default:
		slog.Error("classroomapi: request failed", "error", err, "path", r.URL.Path)
		httpx.WriteError(w, http.StatusBadGateway, "Google Classroom did not answer as expected", "google_failed")
	}
}
