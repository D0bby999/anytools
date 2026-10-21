// Package calendarapi is the study calendar's HTTP surface
// (learning-tool-connections phase 2).
//
// Three routes are the learner's, behind RequireUser like everything else.
// The fourth, POST /v1/calendar/feed/read, is GATEWAY-ONLY: a calendar app
// fetching /cal/<token>.ics has no session, so the BFF forwards the token
// with the gateway bearer and no user, and the token alone picks the feed.
package calendarapi

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/calendar"
)

// ReadPattern is the gateway-only route; httpx.GatewayOnlyPaths lists it.
const ReadPattern = "POST /v1/calendar/feed/read"

// Handler serves the calendar routes.
type Handler struct {
	svc *calendar.Service
}

// NewHandler returns a Handler.
func NewHandler(svc *calendar.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes attaches the routes.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/calendar/feed", h.get)
	mux.HandleFunc("PUT /v1/calendar/feed", h.update)         // budget: none
	mux.HandleFunc("POST /v1/calendar/feed/rotate", h.rotate) // budget: none
	mux.HandleFunc("POST /v1/calendar/feed/read", h.read)     // budget: none (gateway-only)
}

// Patterns lists what RegisterRoutes registers.
func Patterns() []string {
	return []string{"GET /v1/calendar/feed", "PUT /v1/calendar/feed", "POST /v1/calendar/feed/rotate", ReadPattern}
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	f, err := h.svc.Get(r.Context(), httpx.MustUserID(r.Context()))
	h.reply(w, r, f, err)
}

func (h *Handler) rotate(w http.ResponseWriter, r *http.Request) {
	f, err := h.svc.Rotate(r.Context(), httpx.MustUserID(r.Context()))
	h.reply(w, r, f, err)
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Named   bool             `json:"named"`
		Include calendar.Include `json:"include"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	f, err := h.svc.Update(r.Context(), httpx.MustUserID(r.Context()), body.Named, body.Include)
	h.reply(w, r, f, err)
}

func (h *Handler) reply(w http.ResponseWriter, r *http.Request, f *calendar.Feed, err error) {
	if err != nil {
		slog.Error("calendarapi: request failed", "error", err, "path", r.URL.Path)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, f)
}

// read renders a feed for a calendar app. A token that matches nothing is a
// plain 404, the same for a rotated token as for one that never existed.
func (h *Handler) read(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token string `json:"token"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	ics, err := h.svc.Render(r.Context(), body.Token)
	if errors.Is(err, calendar.ErrNoFeed) {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return
	}
	if err != nil {
		slog.Error("calendarapi: render failed", "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
		return
	}
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(ics)
}
