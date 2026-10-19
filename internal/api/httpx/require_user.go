package httpx

import (
	"context"
	"crypto/subtle"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

// UserIDHeader carries the end user's uuid from the BFF to the API.
//
// It is only trustworthy because of the trust boundary in docs/architecture.md:
// the API port is never published, and the RR7 BFF — which owns the entire
// OAuth dance — is its only client. The bearer token below is what proves the
// caller IS the BFF; this header is what the BFF asserts on the user's behalf.
// Both are required. postclaw carried the same shape but relied on an nginx
// rule to keep the API private; AnyTools keeps it private by construction.
const UserIDHeader = "X-AnyTools-User-Id"

// UserLookup is the narrow slice of the user store RequireUser needs. Keeping
// it to one method means the middleware cannot accidentally grow authorization
// logic that belongs in a handler.
type UserLookup interface {
	UserExists(ctx context.Context, id uuid.UUID) (bool, error)
}

// UserLanguageLookup is a UserLookup that reads the learner's interface
// language in the same query, for Localize. A lookup without it leaves the
// language unset, which Localize treats as English.
type UserLanguageLookup interface {
	UserLanguage(ctx context.Context, id uuid.UUID) (exists bool, language string, err error)
}

// AllowlistedPaths are the ONLY request paths served without authentication.
//
// The list is exactly one entry and a structural test (mux_allowlist_test.go)
// asserts every other registered pattern sits behind RequireUser. Adding an
// entry here is a deliberate, reviewable act — the failure mode it prevents is
// a route quietly registered outside the middleware, which is how "one
// unauthenticated endpoint" becomes a data breach.
// Keys are "METHOD /path" — the method is part of the exemption, not decoration.
// Keying on the path alone means a later phase adding GET /v1/auth/identity
// silently inherits the user-id exemption written for the POST.
var AllowlistedPaths = map[string]bool{
	"GET /health": true,
}

// GatewayOnlyPaths are authenticated by the bearer token but NOT by a user id.
//
// There is exactly one, and there is exactly one reason for it: POST
// /v1/auth/identity is the endpoint that CREATES the user, so requiring a
// pre-existing X-AnyTools-User-Id on it is a contradiction — a first-time
// signer-in has no id to send. These paths are not unauthenticated: the bearer
// check above still runs, so only the BFF can reach them.
//
// When such a request DOES carry a user id header (the account-linking case,
// where the browser is already signed in), it is validated in full and placed
// in the context exactly as on any other route. The handler then refuses to
// link to any user other than that verified one, so "link to an arbitrary
// account" is not reachable even from the BFF.
var GatewayOnlyPaths = map[string]bool{
	"POST /v1/auth/identity": true,
}

// RequireUser is AnyTools' single authentication chokepoint. It wraps the
// WHOLE mux rather than individual handlers, so a route added in a later phase
// is authenticated by default and must be explicitly allowlisted to escape.
//
// It requires BOTH:
//   - Authorization: Bearer <gateway token> — proves the caller is the BFF
//   - X-AnyTools-User-Id: <uuid> — names a live, non-deleted user
//
// and otherwise answers 401 without saying which half failed.
func RequireUser(next http.Handler, gatewayToken string, users UserLookup, allowNoAuth bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		route := r.Method + " " + r.URL.Path

		// Exact match only, and deliberately so. Anything that is not character
		// for character an allowlisted route — a trailing slash, a dot segment,
		// a different method — falls through to full authentication. That is the
		// safe direction: the failure mode is "an exempt route asks for
		// credentials", never "a protected route stops asking".
		if AllowlistedPaths[route] {
			next.ServeHTTP(w, r)
			return
		}

		if !allowNoAuth {
			if !bearerMatches(r, gatewayToken) {
				unauthorized(w, r, "bad_gateway_token")
				return
			}
		}

		gatewayOnly := GatewayOnlyPaths[route]

		rawID := strings.TrimSpace(r.Header.Get(UserIDHeader))
		if rawID == "" {
			if gatewayOnly {
				// No user yet — this is a first sign-in. The bearer above is
				// the whole authentication for this request.
				next.ServeHTTP(w, r)
				return
			}
			unauthorized(w, r, "missing_user_id")
			return
		}
		userID, err := uuid.Parse(rawID)
		if err != nil || userID == uuid.Nil {
			unauthorized(w, r, "malformed_user_id")
			return
		}

		var exists bool
		var language string
		if ll, ok := users.(UserLanguageLookup); ok {
			exists, language, err = ll.UserLanguage(r.Context(), userID)
		} else {
			exists, err = users.UserExists(r.Context(), userID)
		}
		if err != nil {
			// A lookup failure is not an authorization decision. Answering 401
			// here would log users out on a database blip; 503 says "retry".
			slog.Error("httpx: user lookup failed", "error", err, "path", r.URL.Path)
			WriteError(w, http.StatusServiceUnavailable, "user lookup unavailable", "lookup_unavailable")
			return
		}
		if !exists {
			// Covers both "never existed" and "soft-deleted": a deleted
			// account's still-valid session cookie must stop working.
			unauthorized(w, r, "unknown_user")
			return
		}

		next.ServeHTTP(w, r.WithContext(WithLanguage(WithUserID(r.Context(), userID), language)))
	})
}

func bearerMatches(r *http.Request, expected string) bool {
	if expected == "" {
		// An empty expected token with auth enabled means the process booted
		// misconfigured. config.Validate refuses that, but if it were ever
		// reached, accepting everything is the wrong answer.
		return false
	}
	auth := r.Header.Get("Authorization")
	const scheme = "Bearer "
	if len(auth) <= len(scheme) || !strings.EqualFold(auth[:len(scheme)], scheme) {
		return false
	}
	provided := auth[len(scheme):]
	return subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

// unauthorized answers with one undifferentiated 401. The specific reason goes
// to the log, never to the response: telling a caller whether the token or the
// user id was wrong turns the endpoint into an oracle for probing both.
func unauthorized(w http.ResponseWriter, r *http.Request, reason string) {
	slog.Warn("security.unauthorized", "reason", reason, "path", r.URL.Path, "method", r.Method)
	WriteError(w, http.StatusUnauthorized, "unauthorized", "unauthorized")
}
