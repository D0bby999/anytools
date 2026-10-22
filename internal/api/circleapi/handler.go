// Package circleapi serves study circles: friends who see each other's
// steadiness and cheer each other on (the private design notes).
package circleapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/circles"
)

// Handler serves /v1/circles.
type Handler struct{ svc *circles.Service }

// NewHandler builds a Handler.
func NewHandler(svc *circles.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes registers the routes.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/circles", h.list)
	mux.HandleFunc("POST /v1/circles", h.create)    // budget: social
	mux.HandleFunc("POST /v1/circles/join", h.join) // budget: social
	mux.HandleFunc("GET /v1/circles/{id}", h.detail)
	mux.HandleFunc("PATCH /v1/circles/{id}", h.patch)        // budget: none
	mux.HandleFunc("POST /v1/circles/{id}/invite", h.invite) // budget: social
	mux.HandleFunc("POST /v1/circles/{id}/leave", h.leave)   // budget: none
	mux.HandleFunc("POST /v1/circles/{id}/remove", h.remove) // budget: none
	mux.HandleFunc("POST /v1/circles/{id}/cheers", h.cheer)  // budget: social
}

// Patterns are the routes, for the server's allowlist.
func Patterns() []string {
	return []string{
		"GET /v1/circles",
		"POST /v1/circles",
		"POST /v1/circles/join",
		"GET /v1/circles/{id}",
		"PATCH /v1/circles/{id}",
		"POST /v1/circles/{id}/invite",
		"POST /v1/circles/{id}/leave",
		"POST /v1/circles/{id}/remove",
		"POST /v1/circles/{id}/cheers",
	}
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	user := httpx.MustUserID(r.Context())
	list, err := h.svc.List(r.Context(), user)
	if err != nil {
		fail(w, r, err)
		return
	}
	cheers, err := h.svc.RecentCheers(r.Context(), user)
	if err != nil {
		fail(w, r, err)
		return
	}
	if list == nil {
		list = []circles.Circle{}
	}
	if cheers == nil {
		cheers = []circles.Cheer{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"circles": list, "cheers": cheers})
}

type createRequest struct {
	Name     string `json:"name"`
	Nickname string `json:"nickname"`
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	c, err := h.svc.Create(r.Context(), httpx.MustUserID(r.Context()), req.Name, req.Nickname)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, c)
}

type joinRequest struct {
	Code     string `json:"code"`
	Nickname string `json:"nickname"`
}

func (h *Handler) join(w http.ResponseWriter, r *http.Request) {
	var req joinRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	c, err := h.svc.Join(r.Context(), httpx.MustUserID(r.Context()), req.Code, req.Nickname)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, c)
}

func circleID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		notFound(w)
		return uuid.Nil, false
	}
	return id, true
}

func (h *Handler) detail(w http.ResponseWriter, r *http.Request) {
	id, ok := circleID(w, r)
	if !ok {
		return
	}
	d, err := h.svc.Detail(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, d)
}

type patchRequest struct {
	Name     *string `json:"name"`
	Nickname *string `json:"nickname"`
}

func (h *Handler) patch(w http.ResponseWriter, r *http.Request) {
	id, ok := circleID(w, r)
	if !ok {
		return
	}
	var req patchRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	if err := h.svc.Update(r.Context(), httpx.MustUserID(r.Context()), id, req.Name, req.Nickname); err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) invite(w http.ResponseWriter, r *http.Request) {
	id, ok := circleID(w, r)
	if !ok {
		return
	}
	code, err := h.svc.NewInvite(r.Context(), httpx.MustUserID(r.Context()), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"invite_code": code})
}

func (h *Handler) leave(w http.ResponseWriter, r *http.Request) {
	id, ok := circleID(w, r)
	if !ok {
		return
	}
	if err := h.svc.Leave(r.Context(), httpx.MustUserID(r.Context()), id); err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// memberRequest names a member of the path's circle by their membership id.
type memberRequest struct {
	MemberID uuid.UUID `json:"member_id"`
}

func (h *Handler) remove(w http.ResponseWriter, r *http.Request) {
	id, ok := circleID(w, r)
	if !ok {
		return
	}
	var req memberRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil || req.MemberID == uuid.Nil {
		badRequest(w, "member_id is required")
		return
	}
	if err := h.svc.Remove(r.Context(), httpx.MustUserID(r.Context()), id, req.MemberID); err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) cheer(w http.ResponseWriter, r *http.Request) {
	id, ok := circleID(w, r)
	if !ok {
		return
	}
	var req memberRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil || req.MemberID == uuid.Nil {
		badRequest(w, "member_id is required")
		return
	}
	fresh, err := h.svc.Cheer(r.Context(), httpx.MustUserID(r.Context()), id, req.MemberID)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"new": fresh})
}

func badRequest(w http.ResponseWriter, msg string) {
	httpx.WriteError(w, http.StatusBadRequest, msg, "bad_request")
}

func notFound(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusNotFound, "no such study circle", "not_found")
}

func fail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, circles.ErrNotFound):
		notFound(w)
	case errors.Is(err, circles.ErrNotOwner):
		httpx.WriteError(w, http.StatusForbidden, "only the circle's owner can do that", "not_owner")
	case errors.Is(err, circles.ErrFull):
		httpx.WriteError(w, http.StatusConflict, "the circle is full", "circle_full")
	case errors.Is(err, circles.ErrTooMany):
		httpx.WriteError(w, http.StatusConflict, "you are in as many circles as you can be; leave one first", "too_many_circles")
	case errors.Is(err, circles.ErrInvalid):
		badRequest(w, strings.TrimPrefix(err.Error(), "circles: invalid: "))
	default:
		slog.Error("circleapi: request failed", "error", err, "path", r.URL.Path, "method", r.Method)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}
