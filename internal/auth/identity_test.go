package auth_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/auth"
	"github.com/D0bby999/anytools/internal/store"
)

// recordingStore captures what the service forwards, so the tests can assert
// on normalization and on refusals that never reach the database.
type recordingStore struct {
	gotClaims store.IdentityClaims
	gotLinkTo uuid.UUID
	called    bool
	user      *store.User
	err       error
}

func (r *recordingStore) UpsertIdentity(_ context.Context, c store.IdentityClaims, linkTo uuid.UUID) (*store.User, error) {
	r.called = true
	r.gotClaims = c
	r.gotLinkTo = linkTo
	if r.err != nil {
		return nil, r.err
	}
	if r.user != nil {
		return r.user, nil
	}
	return &store.User{ID: uuid.New(), Email: c.Email, DisplayName: c.DisplayName}, nil
}

func (r *recordingStore) GetUser(context.Context, uuid.UUID) (*store.User, error) {
	return nil, store.ErrUserNotFound
}
func (r *recordingStore) UserExists(context.Context, uuid.UUID) (bool, error) { return false, nil }

func verified(provider string) store.IdentityClaims {
	return store.IdentityClaims{
		Provider: provider, Subject: "sub-1", Email: "chau@example.test",
		EmailVerified: true, DisplayName: "Chau",
	}
}

func TestSignInForwardsVerifiedClaims(t *testing.T) {
	st := &recordingStore{}
	linkTo := uuid.New()

	if _, err := auth.NewService(st).SignIn(context.Background(), verified("google"), linkTo); err != nil {
		t.Fatalf("SignIn: %v", err)
	}
	if !st.called {
		t.Fatal("store was not called")
	}
	if st.gotLinkTo != linkTo {
		t.Fatalf("linkTo = %s, want %s", st.gotLinkTo, linkTo)
	}
}

func TestSignInNormalizesProviderCase(t *testing.T) {
	st := &recordingStore{}
	c := verified("GitHub")

	if _, err := auth.NewService(st).SignIn(context.Background(), c, uuid.Nil); err != nil {
		t.Fatalf("SignIn: %v", err)
	}
	if st.gotClaims.Provider != "github" {
		t.Fatalf("provider = %q, want %q", st.gotClaims.Provider, "github")
	}
}

// An unknown provider is refused in Go rather than left to the database CHECK
// constraint, so the caller gets a clear 400 instead of a constraint violation.
func TestSignInRefusesUnsupportedProviderBeforeTouchingTheStore(t *testing.T) {
	st := &recordingStore{}
	c := verified("facebook")

	_, err := auth.NewService(st).SignIn(context.Background(), c, uuid.Nil)
	if !errors.Is(err, auth.ErrUnsupportedProvider) {
		t.Fatalf("want ErrUnsupportedProvider, got %v", err)
	}
	if st.called {
		t.Fatal("store was called for an unsupported provider")
	}
}

func TestSignInRefusesUnverifiedEmailBeforeTouchingTheStore(t *testing.T) {
	st := &recordingStore{}
	c := verified("google")
	c.EmailVerified = false

	_, err := auth.NewService(st).SignIn(context.Background(), c, uuid.Nil)
	if !errors.Is(err, store.ErrUnverifiedEmail) {
		t.Fatalf("want ErrUnverifiedEmail, got %v", err)
	}
	if st.called {
		t.Fatal("store was called with an unverified email")
	}
}

func TestSupportedProviderSet(t *testing.T) {
	for _, p := range []string{"google", "github"} {
		if !auth.IsSupportedProvider(p) {
			t.Fatalf("%q should be supported", p)
		}
	}
	for _, p := range []string{"", "facebook", "Google", "apple"} {
		if auth.IsSupportedProvider(p) {
			t.Fatalf("%q should not be supported", p)
		}
	}
}

func TestLocalSignInIsRefusedUnlessEnabled(t *testing.T) {
	st := &recordingStore{}
	claims := verified(auth.LocalProvider)
	if _, err := auth.NewService(st).SignIn(context.Background(), claims, uuid.Nil); !errors.Is(err, auth.ErrUnsupportedProvider) {
		t.Fatalf("local sign-in without the flag: err = %v", err)
	}
	if _, err := auth.NewService(st).WithLocalSignIn(true).SignIn(context.Background(), claims, uuid.Nil); err != nil {
		t.Fatalf("local sign-in with the flag: %v", err)
	}
}
