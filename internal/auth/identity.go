// Package auth applies AnyTools' account-linking policy to the verified
// claims the BFF sends it.
//
// The Go API never speaks to Google or GitHub. The RR7 BFF owns the entire
// OAuth dance — authorization redirect, state cookie, code exchange, id_token
// signature verification — and posts only the resulting verified claims here
// (docs/architecture.md). This package's job is the account decision, not the
// protocol.
package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/store"
)

// SupportedProviders is the closed set of identity providers. A provider not
// listed here is refused before it reaches the database, where the
// user_identities CHECK constraint would reject it anyway — the Go-side check
// turns a constraint violation into a clear 400.
var SupportedProviders = []string{"google", "github"}

// ErrUnsupportedProvider is returned for a provider outside SupportedProviders.
var ErrUnsupportedProvider = errors.New("auth: unsupported identity provider")

// LocalProvider is the development-only identity for reviewing AnyTools on
// one's own machine before an OAuth app exists. It is refused unless the
// service was built with WithLocalSignIn(true), which the wiring does only
// when ANYTOOLS_ENV is exactly "development".
const LocalProvider = "local"

// Service applies the linking policy.
type Service struct {
	users      store.UserStore
	allowLocal bool
}

// WithLocalSignIn enables the development-only local provider.
func (s *Service) WithLocalSignIn(enabled bool) *Service {
	s.allowLocal = enabled
	return s
}

// NewService builds the identity service.
func NewService(users store.UserStore) *Service { return &Service{users: users} }

// SignIn resolves verified provider claims to an AnyTools user, creating or
// linking as the policy in store/pg/users.go UpsertIdentity dictates.
//
// linkToUserID is the user the browser is currently signed in as, or uuid.Nil
// when signed out. That distinction is the whole security content of the
// linking policy: linking on a proven session is safe, linking on an
// unauthenticated callback is account takeover.
func (s *Service) SignIn(ctx context.Context, claims store.IdentityClaims, linkToUserID uuid.UUID) (*store.User, error) {
	claims.Provider = strings.ToLower(strings.TrimSpace(claims.Provider))
	if !IsSupportedProvider(claims.Provider) && !(s.allowLocal && claims.Provider == LocalProvider) {
		return nil, fmt.Errorf("%w: %q", ErrUnsupportedProvider, claims.Provider)
	}
	if !claims.EmailVerified {
		return nil, fmt.Errorf("%w: provider %q", store.ErrUnverifiedEmail, claims.Provider)
	}
	return s.users.UpsertIdentity(ctx, claims, linkToUserID)
}

// IsSupportedProvider reports whether provider is one AnyTools accepts.
func IsSupportedProvider(provider string) bool {
	for _, p := range SupportedProviders {
		if p == provider {
			return true
		}
	}
	return false
}
