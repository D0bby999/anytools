// Package httpx holds the HTTP plumbing every AnyTools API handler shares: the
// single authentication chokepoint, JSON helpers, panic recovery and rate
// limiting.
package httpx

import (
	"context"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/locale"
)

type contextKey struct{ name string }

var userIDKey = contextKey{"anytools.user_id"}

// WithUserID attaches an authenticated user id to the context. Only
// RequireUser calls this in production code; tests use it to build a request
// that has already passed the middleware.
func WithUserID(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, userIDKey, id)
}

// UserID returns the authenticated user id from the context.
//
// Handlers must read the caller's identity ONLY through this function, never
// from a header, a query parameter or a request body. Every route outside the
// allowlist runs behind RequireUser, so a handler reaching this point always
// has a verified id; a handler that re-read the header would be trusting an
// input the middleware exists to validate.
func UserID(ctx context.Context) (uuid.UUID, bool) {
	id, ok := ctx.Value(userIDKey).(uuid.UUID)
	return id, ok && id != uuid.Nil
}

// MustUserID returns the authenticated user id, or uuid.Nil when absent. Use
// only where RequireUser is guaranteed to have run.
func MustUserID(ctx context.Context) uuid.UUID {
	id, _ := UserID(ctx)
	return id
}

// WithLanguage attaches the learner's interface language (users.language).
// RequireUser sets it beside the user id; Localize reads it, and so do the
// prompts, through locale.FromContext (the key is locale's, so a capability
// need not import this package).
func WithLanguage(ctx context.Context, lang string) context.Context {
	return locale.WithLanguage(ctx, lang)
}

// Language is the learner's interface language, "" before RequireUser.
func Language(ctx context.Context) string { return locale.FromContext(ctx) }
