// Package inboundapi is email in's HTTP surface (learning-tool-connections
// phase 4).
//
// POST /v1/inbound/email is GATEWAY-ONLY: the Cloudflare Email Worker posts a
// signed message to the BFF, which forwards it here with the gateway bearer
// and no user. The signature, checked in internal/inbound, is what proves the
// Worker sent it; the address in X-Inbound-Recipient is what picks the
// learner. The address routes are the learner's, behind RequireUser.
package inboundapi

import (
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/inbound"
)

// DeliverPattern is the gateway-only route; httpx.GatewayOnlyPaths lists it.
const DeliverPattern = "POST /v1/inbound/email"

// Handler serves the inbound routes.
type Handler struct{ svc *inbound.Service }

// NewHandler returns a Handler.
func NewHandler(svc *inbound.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes attaches the routes.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/inbound/address", h.address)
	mux.HandleFunc("PUT /v1/inbound/address", h.setKB)          // budget: none
	mux.HandleFunc("POST /v1/inbound/address/rotate", h.rotate) // budget: none
	mux.HandleFunc("POST /v1/inbound/email", h.deliver)         // budget: none (gateway-only; the upload pipeline queues the parse)
}

// Patterns lists what RegisterRoutes registers.
func Patterns() []string {
	return []string{"GET /v1/inbound/address", "PUT /v1/inbound/address", "POST /v1/inbound/address/rotate", DeliverPattern}
}

type addressView struct {
	Enabled bool               `json:"enabled"`
	Address *inbound.Address   `json:"address"`
	Recent  []inbound.Received `json:"recent"`
}

func (h *Handler) view(w http.ResponseWriter, r *http.Request, a *inbound.Address, err error) {
	if err != nil {
		h.fail(w, r, err)
		return
	}
	recent, err := h.svc.Recent(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, addressView{Enabled: h.svc.Enabled(), Address: a, Recent: recent})
}

func (h *Handler) address(w http.ResponseWriter, r *http.Request) {
	a, err := h.svc.Address(r.Context(), httpx.MustUserID(r.Context()))
	h.view(w, r, a, err)
}

func (h *Handler) rotate(w http.ResponseWriter, r *http.Request) {
	a, err := h.svc.Rotate(r.Context(), httpx.MustUserID(r.Context()))
	h.view(w, r, a, err)
}

func (h *Handler) setKB(w http.ResponseWriter, r *http.Request) {
	var body struct {
		KBID string `json:"kb_id"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	kbID, err := uuid.Parse(body.KBID)
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return
	}
	user := httpx.MustUserID(r.Context())
	if err := h.svc.SetKB(r.Context(), user, kbID); err != nil {
		h.fail(w, r, err)
		return
	}
	a, err := h.svc.Address(r.Context(), user)
	h.view(w, r, a, err)
}

// deliver files one message. The status codes are what the Worker turns into
// a bounce (404, 413, 429, 422) or a retry (5xx).
func (h *Handler) deliver(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, inbound.MaxMessageBytes+1))
	if err != nil || len(raw) > inbound.MaxMessageBytes {
		httpx.WriteError(w, http.StatusRequestEntityTooLarge, "message too large", "too_large")
		return
	}
	res, err := h.svc.Receive(r.Context(), inbound.Delivery{
		Recipient: r.Header.Get("X-Inbound-Recipient"),
		Timestamp: r.Header.Get("X-Inbound-Timestamp"),
		Signature: r.Header.Get("X-Inbound-Signature"),
		Raw:       raw,
	})
	switch {
	case err == nil:
		httpx.WriteJSON(w, http.StatusOK, res)
	case errors.Is(err, inbound.ErrBadSignature):
		slog.Warn("security.inbound_bad_signature")
		httpx.WriteError(w, http.StatusUnauthorized, "bad signature", "bad_signature")
	case errors.Is(err, inbound.ErrUnknownAddress):
		httpx.WriteError(w, http.StatusNotFound, "unknown address", "unknown_address")
	case errors.Is(err, inbound.ErrTooLarge):
		httpx.WriteError(w, http.StatusRequestEntityTooLarge, "message too large", "too_large")
	case errors.Is(err, inbound.ErrTooMany):
		httpx.WriteError(w, http.StatusTooManyRequests, "daily limit reached", "too_many")
	case errors.Is(err, inbound.ErrUnreadable):
		httpx.WriteError(w, http.StatusUnprocessableEntity, "not an email", "unreadable")
	case errors.Is(err, inbound.ErrNotConfigured):
		httpx.WriteError(w, http.StatusServiceUnavailable, "email is not configured", "not_configured")
	default:
		slog.Error("inboundapi: delivery failed", "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, authz.ErrNoAccess) {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return
	}
	slog.Error("inboundapi: request failed", "error", err, "path", r.URL.Path)
	httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
}
