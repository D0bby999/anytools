// Package store defines the narrow persistence interfaces AnyTools' features
// consume. Interfaces live next to their consumer, never in one `Stores`
// service-locator struct: postclaw's grew to 60 fields and every handler took a
// dependency on all of them (scout report §5, "Needs rewrite").
package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// ErrUserNotFound is returned when no live user matches the lookup.
var ErrUserNotFound = errors.New("store: user not found")

// ErrUnverifiedEmail is returned when the provider did not assert that the
// user controls the address. Trusting an unverified address would let anyone
// who can register it at any provider AnyTools accepts claim the account.
var ErrUnverifiedEmail = errors.New("store: provider did not assert a verified email")

// ErrInvalidClaims is returned when the BFF sent a structurally unusable
// identity (blank provider, subject or email).
var ErrInvalidClaims = errors.New("store: invalid identity claims")

// ErrEmailBelongsToAnotherUser is returned by UpsertIdentity when the claimed
// email already has an account that the caller is not signed in as. Auto-linking
// there would let anyone who can obtain a token for any provider asserting that
// address take over the existing account.
var ErrEmailBelongsToAnotherUser = errors.New("store: email already belongs to another user")

// User is an AnyTools account.
type User struct {
	ID              uuid.UUID
	Email           string
	EmailVerifiedAt *time.Time
	DisplayName     string
	CreatedAt       time.Time
	DeletedAt       *time.Time
	// Timezone is an IANA name, 'UTC' until the learner's browser or the
	// learner set one (TimezoneSetAt). learning.LocalDay reads it.
	Timezone      string
	TimezoneSetAt *time.Time
	// OwnVersionFirst requires the three lines before Solve and chat
	// (internal/learning/ownversion).
	OwnVersionFirst bool
	// FileStorage is where the learner's own files are written: "server"
	// or "drive" (drive-user-storage phase 2, opt-in by owner decision 2).
	FileStorage string
}

// IdentityClaims are the verified facts the BFF extracted from a provider.
// They arrive already verified: the Go API never talks to Google or GitHub.
type IdentityClaims struct {
	Provider      string
	Subject       string
	Email         string
	EmailVerified bool
	DisplayName   string
}

// UserStore is the persistence surface for accounts and their linked
// identities.
type UserStore interface {
	// UpsertIdentity applies the account linking policy and returns the
	// resulting user. linkToUserID is the id of the user the browser is
	// currently signed in as, or uuid.Nil when signed out.
	UpsertIdentity(ctx context.Context, claims IdentityClaims, linkToUserID uuid.UUID) (*User, error)
	// GetUser returns a live (not soft-deleted) user by id.
	GetUser(ctx context.Context, id uuid.UUID) (*User, error)
	// UserExists reports whether id names a live user. It is the hot path for
	// the RequireUser middleware, so it avoids materializing the row.
	UserExists(ctx context.Context, id uuid.UUID) (bool, error)
}
