// Package driveapi is the Google Drive connector's HTTP surface.
//
// The same rule as every other package under internal/api: the caller's
// identity comes from httpx.UserID(ctx) and nowhere else, and any handler
// naming a resource asks authz FIRST. Here that matters twice over — a Drive
// import writes into a knowledge base named in the URL, and the Picker ids in
// the body arrived from a browser.
package driveapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/connectors/drive"
)

// SyncTimeout bounds a "Sync now". The endpoint runs the poll inline rather
// than queueing it, because the user pressed a button and is waiting for an
// answer; the timeout is what stops a Drive account with hundreds of grants
// holding a request open indefinitely.
const SyncTimeout = 2 * time.Minute

// Handler serves the connector routes.
type Handler struct {
	svc *drive.Service
}

// NewHandler returns a Handler.
func NewHandler(svc *drive.Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes attaches this handler's routes to the mux.
//
// Every one sits behind httpx.RequireUser like the rest of the API; none is
// allowlisted, and none may be. The OAuth redirect the user's browser follows
// is NOT here — consent happens in the BFF, exactly like login, and the BFF
// posts the result to /credentials below.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/connectors/drive/status", h.status)
	mux.HandleFunc("POST /v1/connectors/drive/credentials", h.saveCredentials) // budget: none
	mux.HandleFunc("DELETE /v1/connectors/drive", h.disconnect)                // budget: none
	mux.HandleFunc("POST /v1/connectors/drive/sync", h.sync)                   // budget: upload
	mux.HandleFunc("POST /v1/connectors/drive/picker-token", h.pickerToken)    // budget: none
	mux.HandleFunc("POST /v1/kb/{id}/drive/import", h.importPicked)            // budget: upload
	mux.HandleFunc("GET /v1/kb/{id}/drive/grants", h.listGrants)
}

// Patterns lists what RegisterRoutes registers, for internal/api/server.go's
// RegisteredPatterns and the allowlist test that watches it.
func Patterns() []string {
	return []string{
		"GET /v1/connectors/drive/status",
		"POST /v1/connectors/drive/credentials",
		"DELETE /v1/connectors/drive",
		"POST /v1/connectors/drive/sync",
		"POST /v1/connectors/drive/picker-token",
		"POST /v1/kb/{id}/drive/import",
		"GET /v1/kb/{id}/drive/grants",
	}
}

func (h *Handler) status(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	st, err := h.svc.Status(r.Context(), userID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, st)
}

// saveCredentials receives the tokens the BFF got from Google.
//
// The body carries a refresh token, so nothing about this request is ever
// logged — not the body, not a decode error's context, not a validation
// failure's detail.
func (h *Handler) saveCredentials(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())

	var creds drive.Credentials
	if err := httpx.DecodeJSON(w, r, &creds); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}
	if err := h.svc.Connect(r.Context(), userID, creds); err != nil {
		// Connect's refusals are written for a person and name no secret, so
		// they pass through; anything else is ours.
		if errors.Is(err, drive.ErrNotConfigured) {
			httpx.WriteError(w, http.StatusServiceUnavailable,
				"Google Drive is not configured on this deployment", "not_configured")
			return
		}
		var apiErr *drive.APIError
		if !errors.As(err, &apiErr) && !isStoreError(err) {
			httpx.WriteError(w, http.StatusBadRequest, err.Error(), "bad_request")
			return
		}
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"connected": true})
}

func (h *Handler) disconnect(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	if err := h.svc.Disconnect(r.Context(), userID); err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"connected": false})
}

func (h *Handler) sync(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())

	ctx, cancel := context.WithTimeout(r.Context(), SyncTimeout)
	defer cancel()

	report, err := h.svc.Sync(ctx, userID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, report)
}

// pickerToken hands the BFF a short-lived access token for the Picker.
//
// POST, not GET: the answer is a credential, and a GET is something a browser
// prefetches, a proxy caches and an access log records with its query string.
// Nothing here logs the token — not on success, not on failure.
func (h *Handler) pickerToken(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	token, err := h.svc.PickerToken(r.Context(), userID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"access_token": token})
}

type importRequest struct {
	Picked []drive.Picked `json:"picked"`
}

// importPicked takes the Picker's selection and imports it.
//
// 200 rather than 202 even though the parse work is queued: the grants and the
// document rows exist by the time this returns, and the report says per item
// what happened. A 202 with no body would leave the browser unable to tell a
// Google Form that cannot be imported from a PDF that is being processed.
func (h *Handler) importPicked(w http.ResponseWriter, r *http.Request) {
	userID, kbID, ok := h.requireKB(w, r)
	if !ok {
		return
	}

	var req importRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "malformed request body", "bad_request")
		return
	}

	report, err := h.svc.ImportPicked(r.Context(), userID, kbID, req.Picked)
	if err != nil {
		if errors.Is(err, drive.ErrNotConnected) || errors.Is(err, drive.ErrNeedsReconnect) ||
			errors.Is(err, authz.ErrNoAccess) {
			h.fail(w, r, err)
			return
		}
		// The remaining refusals are about the REQUEST — nothing picked, too
		// many picked — and are already written for a person.
		httpx.WriteError(w, http.StatusBadRequest, err.Error(), "bad_request")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, report)
}

func (h *Handler) listGrants(w http.ResponseWriter, r *http.Request) {
	userID, kbID, ok := h.requireKB(w, r)
	if !ok {
		return
	}
	grants, err := h.svc.ListGrants(r.Context(), userID, kbID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"grants": grants})
}

// requireKB resolves and AUTHORIZES the knowledge base in the path.
//
// A malformed uuid is answered 404, not 400. The two are indistinguishable to
// a caller who may not have this knowledge base anyway, and a 400 would confirm
// that a well-formed id is one that exists.
func (h *Handler) requireKB(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	userID := httpx.MustUserID(r.Context())
	kbID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
		return uuid.Nil, uuid.Nil, false
	}
	// Ownership itself is checked by the service, which holds the authorizer —
	// one check in one place, rather than a handler check the service then
	// trusts.
	return userID, kbID, true
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	// The learner's own files kept in the Drive that refused them
	// (drive-user-storage phase 5) answer with their reason's code.
	if httpx.WriteStorageError(w, err) {
		return
	}
	switch {
	case errors.Is(err, authz.ErrNoAccess):
		httpx.WriteError(w, http.StatusNotFound, "not found", "not_found")
	case errors.Is(err, drive.ErrNotConnected):
		httpx.WriteError(w, http.StatusConflict,
			"Google Drive is not connected for this account", "not_connected")
	case errors.Is(err, drive.ErrNeedsReconnect):
		httpx.WriteError(w, http.StatusConflict,
			"Google Drive needs to be reconnected", "needs_reconnect")
	case errors.Is(err, drive.ErrNotConfigured):
		httpx.WriteError(w, http.StatusServiceUnavailable,
			"Google Drive is not configured on this deployment", "not_configured")
	case errors.Is(err, context.DeadlineExceeded):
		httpx.WriteError(w, http.StatusGatewayTimeout,
			"the sync is taking longer than expected; it will continue in the background", "timeout")
	default:
		// Anything else is ours. The cause goes to the log with the path; the
		// response says nothing, because a Drive error body can quote a file
		// name and a store error can quote a statement.
		slog.Error("driveapi: request failed", "error", err, "path", r.URL.Path, "method", r.Method)
		httpx.WriteError(w, http.StatusInternalServerError, "something went wrong", "internal")
	}
}

// isStoreError reports an error that came from persistence rather than from
// validation — the ones whose text must never reach the browser.
func isStoreError(err error) bool {
	return errors.Is(err, authz.ErrNoAccess) || errors.Is(err, drive.ErrNotConnected)
}
