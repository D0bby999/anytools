// Package authapi exposes the two identity endpoints the BFF calls.
package authapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/auth"
	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/store"
)

// Handler serves POST /v1/auth/identity and GET /v1/me.
type Handler struct {
	identities *auth.Service
	users      store.UserStore
	accounts   AccountDeleter
	sessions   SessionWatermarks
	zones      TimezoneSetter
	ownVersion OwnVersionSetter
}

// TimezoneSetter stores the learner's zone (learning-depth phase 0).
type TimezoneSetter interface {
	SetTimezone(ctx context.Context, id uuid.UUID, zone string, onlyIfUnset bool) (bool, error)
}

// WithTimezones enables PUT /v1/me/timezone.
func (h *Handler) WithTimezones(z TimezoneSetter) *Handler {
	h.zones = z
	return h
}

// OwnVersionSetter stores the "write your own version first" switch
// (up-methods phase 11).
type OwnVersionSetter interface {
	SetOwnVersionFirst(ctx context.Context, id uuid.UUID, on bool) error
}

// WithOwnVersionFirst enables PUT /v1/me/own-version-first.
func (h *Handler) WithOwnVersionFirst(s OwnVersionSetter) *Handler {
	h.ownVersion = s
	return h
}

// SessionWatermarks reads and moves the time before which a user's sessions
// are revoked (security audit F-4).
type SessionWatermarks interface {
	SessionWatermark(ctx context.Context, id uuid.UUID) (*time.Time, error)
	RevokeSessions(ctx context.Context, id uuid.UUID) (time.Time, error)
}

// WithSessionRevocation enables the session watermark routes.
func (h *Handler) WithSessionRevocation(s SessionWatermarks) *Handler {
	h.sessions = s
	return h
}

// NewHandler builds the auth API handler.
func NewHandler(identities *auth.Service, users store.UserStore) *Handler {
	return &Handler{identities: identities, users: users}
}

// RegisterRoutes attaches this handler's routes to the mux. Every feature
// package exposes this one method, so BuildMux stays a list of registrations
// rather than a construction god-function.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/auth/identity", h.postIdentity) // budget: none
	mux.HandleFunc("GET /v1/me", h.getMe)
	if h.accounts != nil {
		mux.HandleFunc("DELETE /v1/me", h.deleteMe) // budget: none
	}
	if h.zones != nil {
		mux.HandleFunc("PUT /v1/me/timezone", h.putTimezone) // budget: none
	}
	if h.ownVersion != nil {
		mux.HandleFunc("PUT /v1/me/own-version-first", h.putOwnVersionFirst) // budget: none
	}
	if h.sessions != nil {
		mux.HandleFunc("GET /v1/auth/session-watermark", h.getWatermark)
		mux.HandleFunc("POST /v1/auth/session-watermark", h.revokeSessions) // budget: none
	}
}

// AccountDeleter removes a user and everything they own (internal/account).
type AccountDeleter interface {
	Delete(ctx context.Context, userID uuid.UUID) error
}

// WithAccountDeletion enables DELETE /v1/me.
func (h *Handler) WithAccountDeletion(d AccountDeleter) *Handler {
	h.accounts = d
	return h
}

// deleteMe deletes the calling user's account.
//
// The id comes from RequireUser's context, never from the request: there is no
// way to name another account here. 204 on success; a second call finds no
// live user and RequireUser answers 401 before this runs.
func (h *Handler) deleteMe(w http.ResponseWriter, r *http.Request) {
	userID := httpx.MustUserID(r.Context())
	if err := h.accounts.Delete(r.Context(), userID); err != nil {
		slog.Error("authapi: delete account", "user", userID, "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "the account could not be deleted", "internal")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// identityRequest carries claims the BFF has ALREADY verified.
//
// email_verified is not a courtesy flag: the BFF sets it only after checking
// the id_token's RS256 signature against the issuer's JWKS (Google) or reading
// a primary+verified address from /user/emails (GitHub). This endpoint refuses
// a false value rather than trusting the caller to have cared.
type identityRequest struct {
	Provider      string `json:"provider"`
	Subject       string `json:"subject"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	DisplayName   string `json:"display_name"`
	// LinkToUserID is the user the browser is currently signed in as. Empty
	// when signed out. Sending it while signed out is what an account-takeover
	// attempt would look like, which is why the BFF derives it from the session
	// cookie and never from the request.
	LinkToUserID string `json:"link_to_user_id"`
}

type userResponse struct {
	ID              string     `json:"id"`
	Email           string     `json:"email"`
	DisplayName     string     `json:"display_name"`
	EmailVerifiedAt *time.Time `json:"email_verified_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	Timezone        string     `json:"timezone"`
	// TimezoneSet is false until the learner's browser or the learner chose
	// a zone; the BFF reports the browser's zone once while it is false.
	TimezoneSet bool `json:"timezone_set"`
	// OwnVersionFirst: Solve and chat ask for the three lines before sending.
	OwnVersionFirst bool `json:"own_version_first"`
	// FileStorage is "server" or "drive": where new files are written, and
	// whether "Save to my Drive" is offered (drive-user-storage phase 2).
	FileStorage string `json:"file_storage"`
}

func (h *Handler) postIdentity(w http.ResponseWriter, r *http.Request) {
	var req identityRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body", "bad_request")
		return
	}

	linkTo := uuid.Nil
	if req.LinkToUserID != "" {
		parsed, err := uuid.Parse(req.LinkToUserID)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "link_to_user_id must be a uuid", "bad_request")
			return
		}
		// Linking joins a new provider identity to an existing account, so the
		// caller must have proven that account is theirs. RequireUser validates
		// X-AnyTools-User-Id against the database; insisting the body agrees
		// with it means a request can only ever link to a user the middleware
		// has already confirmed is live. A body-only user id would let anything
		// that reaches this endpoint graft an identity onto any account.
		verified, ok := httpx.UserID(r.Context())
		if !ok || verified != parsed {
			httpx.WriteError(w, http.StatusForbidden,
				"link_to_user_id must match the signed-in user", "link_mismatch")
			return
		}
		linkTo = parsed
	}

	user, err := h.identities.SignIn(r.Context(), store.IdentityClaims{
		Provider:      req.Provider,
		Subject:       req.Subject,
		Email:         req.Email,
		EmailVerified: req.EmailVerified,
		DisplayName:   req.DisplayName,
	}, linkTo)
	if err != nil {
		writeSignInError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toUserResponse(user))
}

func (h *Handler) getMe(w http.ResponseWriter, r *http.Request) {
	// RequireUser has already proven this id names a live user; reading it from
	// the context rather than the header is what keeps that guarantee true.
	userID := httpx.MustUserID(r.Context())

	user, err := h.users.GetUser(r.Context(), userID)
	if errors.Is(err, store.ErrUserNotFound) {
		// The row disappeared between the middleware's existence check and
		// here (account deletion mid-request).
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "unauthorized")
		return
	}
	if err != nil {
		slog.Error("authapi: get user", "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "could not load user", "internal")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toUserResponse(user))
}

// writeSignInError maps policy refusals to statuses the BFF can branch on.
// The codes are the contract: the login page renders different copy for
// `email_taken` ("sign in with X instead") than for `email_unverified`.
func writeSignInError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrEmailBelongsToAnotherUser):
		httpx.WriteError(w, http.StatusConflict,
			"this email already has an account with a different sign-in method", "email_taken")
	case errors.Is(err, store.ErrUnverifiedEmail):
		httpx.WriteError(w, http.StatusForbidden,
			"the provider did not confirm this email address", "email_unverified")
	case errors.Is(err, auth.ErrUnsupportedProvider), errors.Is(err, store.ErrInvalidClaims):
		httpx.WriteError(w, http.StatusBadRequest, "invalid identity claims", "bad_request")
	case errors.Is(err, store.ErrUserNotFound):
		// linkToUserID named a user that no longer exists — a stale session.
		httpx.WriteError(w, http.StatusUnauthorized, "session is no longer valid", "stale_session")
	default:
		slog.Error("authapi: sign in", "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "could not sign in", "internal")
	}
}

func toUserResponse(u *store.User) userResponse {
	return userResponse{
		ID:              u.ID.String(),
		Email:           u.Email,
		DisplayName:     u.DisplayName,
		EmailVerifiedAt: u.EmailVerifiedAt,
		CreatedAt:       u.CreatedAt,
		Timezone:        u.Timezone,
		TimezoneSet:     u.TimezoneSetAt != nil,
		OwnVersionFirst: u.OwnVersionFirst,
		FileStorage:     u.FileStorage,
	}
}

type timezoneRequest struct {
	Timezone string `json:"timezone"`
	// OnlyIfUnset is the browser's automatic report: it never overwrites a
	// zone the learner already chose.
	OnlyIfUnset bool `json:"only_if_unset"`
}

// putTimezone stores the caller's IANA zone, which every "today" and "next
// day" in the learning features is computed in (learning.LocalDay).
func (h *Handler) putTimezone(w http.ResponseWriter, r *http.Request) {
	var req timezoneRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body", "bad_request")
		return
	}
	loc, err := learning.LoadZone(req.Timezone)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "unknown time zone", "bad_timezone")
		return
	}
	changed, err := h.zones.SetTimezone(r.Context(), httpx.MustUserID(r.Context()), loc.String(), req.OnlyIfUnset)
	if err != nil {
		slog.Error("authapi: set timezone", "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "could not save the time zone", "internal")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"timezone": loc.String(), "changed": changed})
}

type ownVersionRequest struct {
	Enabled *bool `json:"enabled"`
}

// putOwnVersionFirst turns "write your own version first" on or off.
func (h *Handler) putOwnVersionFirst(w http.ResponseWriter, r *http.Request) {
	var req ownVersionRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil || req.Enabled == nil {
		httpx.WriteError(w, http.StatusBadRequest, "enabled must be true or false", "bad_request")
		return
	}
	if err := h.ownVersion.SetOwnVersionFirst(r.Context(), httpx.MustUserID(r.Context()), *req.Enabled); err != nil {
		slog.Error("authapi: set own version first", "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "could not save the setting", "internal")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"own_version_first": *req.Enabled})
}

// getWatermark answers the BFF's per-request revocation check, in unix
// seconds to compare with the cookie's `sat`.
func (h *Handler) getWatermark(w http.ResponseWriter, r *http.Request) {
	at, err := h.sessions.SessionWatermark(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		slog.Error("authapi: session watermark", "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "could not read the session state", "internal")
		return
	}
	var out any
	if at != nil {
		out = at.Unix()
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"sessions_valid_after": out})
}

// revokeSessions ends every session of the calling user minted before now:
// the BFF calls it on sign-out, so a copied cookie dies with the one the user
// meant to close.
func (h *Handler) revokeSessions(w http.ResponseWriter, r *http.Request) {
	at, err := h.sessions.RevokeSessions(r.Context(), httpx.MustUserID(r.Context()))
	if err != nil {
		slog.Error("authapi: revoke sessions", "error", err)
		httpx.WriteError(w, http.StatusInternalServerError, "could not sign out", "internal")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"sessions_valid_after": at.Unix()})
}
