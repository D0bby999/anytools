// Package pushapi is Settings → Reminders' HTTP layer: the server's public
// VAPID key and the learner's reminder hour, turning reminders on and off in a
// browser, and a test reminder.
//
// Identity comes from httpx.MustUserID(ctx) and nowhere else; a learner only
// ever reads and writes their own subscriptions.
package pushapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/push"
)

// Handler serves the reminder routes.
type Handler struct{ svc *push.Service }

// NewHandler returns a Handler.
func NewHandler(svc *push.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes registers this package's patterns on the mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/push", h.get)
	mux.HandleFunc("PUT /v1/push/settings", h.settings)            // budget: none
	mux.HandleFunc("POST /v1/push/subscriptions", h.subscribe)     // budget: none
	mux.HandleFunc("DELETE /v1/push/subscriptions", h.unsubscribe) // budget: none
	mux.HandleFunc("POST /v1/push/test", h.test)                   // budget: verify
}

// Patterns lists what RegisterRoutes registers, for api.RegisteredPatterns().
func Patterns() []string {
	return []string{
		"GET /v1/push",
		"PUT /v1/push/settings",
		"POST /v1/push/subscriptions",
		"DELETE /v1/push/subscriptions",
		"POST /v1/push/test",
	}
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	s, err := h.svc.Settings(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s)
}

type settingsRequest struct {
	Hour *int `json:"hour"`
}

func (h *Handler) settings(w http.ResponseWriter, r *http.Request) {
	var req settingsRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil || req.Hour == nil {
		badRequest(w, "hour must be 0 to 23")
		return
	}
	if err := h.svc.SetHour(r.Context(), httpx.MustUserID(r.Context()), *req.Hour); err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"hour": *req.Hour})
}

// subscriptionRequest is PushSubscription.toJSON(), as the browser makes it.
type subscriptionRequest struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

func (h *Handler) subscribe(w http.ResponseWriter, r *http.Request) {
	var req subscriptionRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		badRequest(w, "malformed request body")
		return
	}
	sub := push.Subscription{Endpoint: req.Endpoint, P256dh: req.Keys.P256dh, Auth: req.Keys.Auth}
	if err := h.svc.Subscribe(r.Context(), httpx.MustUserID(r.Context()), sub); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type unsubscribeRequest struct {
	Endpoint string `json:"endpoint"`
}

func (h *Handler) unsubscribe(w http.ResponseWriter, r *http.Request) {
	var req unsubscribeRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil || req.Endpoint == "" {
		badRequest(w, "endpoint is required")
		return
	}
	if err := h.svc.Unsubscribe(r.Context(), httpx.MustUserID(r.Context()), req.Endpoint); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) test(w http.ResponseWriter, r *http.Request) {
	sent, err := h.svc.Test(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"sent": sent})
}

func badRequest(w http.ResponseWriter, msg string) {
	httpx.WriteError(w, http.StatusBadRequest, msg, "bad_request")
}

// fail maps an error to a response. Only the service's own sentences reach the
// client; anything else is logged and answered with one word.
func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, push.ErrInvalid) {
		badRequest(w, strings.TrimPrefix(err.Error(), "push: invalid: "))
		return
	}
	slog.Error("pushapi: request failed", "error", err, "path", r.URL.Path, "method", r.Method)
	httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
}
