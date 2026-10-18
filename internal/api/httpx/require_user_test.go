package httpx

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

const gatewayToken = "test-gateway-token"

// fakeUsers answers UserExists from a fixed set, and can be made to fail.
type fakeUsers struct {
	live map[uuid.UUID]bool
	err  error
}

func (f *fakeUsers) UserExists(_ context.Context, id uuid.UUID) (bool, error) {
	if f.err != nil {
		return false, f.err
	}
	return f.live[id], nil
}

// probe records whether the wrapped handler ran, and with which user.
type probe struct {
	called bool
	userID uuid.UUID
}

func (p *probe) handler() http.Handler {
	return http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		p.called = true
		p.userID = MustUserID(r.Context())
	})
}

func newStack(t *testing.T, users UserLookup, allowNoAuth bool) (http.Handler, *probe) {
	t.Helper()
	p := &probe{}
	return RequireUser(p.handler(), gatewayToken, users, allowNoAuth), p
}

func do(h http.Handler, method, path string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestRequireUserAcceptsValidBearerAndLiveUser(t *testing.T) {
	live := uuid.New()
	h, p := newStack(t, &fakeUsers{live: map[uuid.UUID]bool{live: true}}, false)

	rec := do(h, http.MethodGet, "/v1/me", map[string]string{
		"Authorization": "Bearer " + gatewayToken,
		UserIDHeader:    live.String(),
	})

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !p.called {
		t.Fatal("handler was not reached")
	}
	if p.userID != live {
		t.Fatalf("context user = %s, want %s", p.userID, live)
	}
}

// Each of these is a separate way in, and each must be a 401 that never reaches
// the handler. A regression in any one of them is an authentication bypass.
func TestRequireUserRejects(t *testing.T) {
	live := uuid.New()
	deleted := uuid.New()
	users := &fakeUsers{live: map[uuid.UUID]bool{live: true}}

	cases := map[string]map[string]string{
		"no headers at all":    {},
		"no bearer":            {UserIDHeader: live.String()},
		"wrong bearer":         {"Authorization": "Bearer wrong-token", UserIDHeader: live.String()},
		"bearer without value": {"Authorization": "Bearer ", UserIDHeader: live.String()},
		"wrong scheme":         {"Authorization": "Basic " + gatewayToken, UserIDHeader: live.String()},
		"no user id":           {"Authorization": "Bearer " + gatewayToken},
		"blank user id":        {"Authorization": "Bearer " + gatewayToken, UserIDHeader: "   "},
		"non-uuid user id":     {"Authorization": "Bearer " + gatewayToken, UserIDHeader: "chau@example.com"},
		"nil uuid":             {"Authorization": "Bearer " + gatewayToken, UserIDHeader: uuid.Nil.String()},
		"unknown user":         {"Authorization": "Bearer " + gatewayToken, UserIDHeader: uuid.New().String()},
		"deleted user":         {"Authorization": "Bearer " + gatewayToken, UserIDHeader: deleted.String()},
	}

	for name, headers := range cases {
		t.Run(name, func(t *testing.T) {
			h, p := newStack(t, users, false)
			rec := do(h, http.MethodGet, "/v1/me", headers)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401", rec.Code)
			}
			if p.called {
				t.Fatal("handler was reached — authentication bypass")
			}
		})
	}
}

// The 401 body must not say which half of the credential failed; doing so turns
// the endpoint into an oracle for enumerating valid tokens and user ids.
func TestUnauthorizedBodyDoesNotLeakReason(t *testing.T) {
	live := uuid.New()
	users := &fakeUsers{live: map[uuid.UUID]bool{live: true}}

	badToken, _ := newStack(t, users, false)
	badUser, _ := newStack(t, users, false)

	a := do(badToken, http.MethodGet, "/v1/me", map[string]string{
		"Authorization": "Bearer wrong", UserIDHeader: live.String()}).Body.String()
	b := do(badUser, http.MethodGet, "/v1/me", map[string]string{
		"Authorization": "Bearer " + gatewayToken, UserIDHeader: uuid.New().String()}).Body.String()

	if a != b {
		t.Fatalf("401 bodies differ and reveal which credential failed:\n token: %s\n user:  %s", a, b)
	}
}

func TestHealthIsAllowlisted(t *testing.T) {
	h, p := newStack(t, &fakeUsers{}, false)
	rec := do(h, http.MethodGet, "/health", nil)
	if rec.Code != http.StatusOK || !p.called {
		t.Fatalf("/health should bypass auth: status=%d called=%v", rec.Code, p.called)
	}
}

// A database blip is not an authorization decision: answering 401 would sign
// every user out; 503 tells the BFF to retry.
func TestLookupFailureIs503NotUnauthorized(t *testing.T) {
	h, p := newStack(t, &fakeUsers{err: errors.New("connection refused")}, false)
	rec := do(h, http.MethodGet, "/v1/me", map[string]string{
		"Authorization": "Bearer " + gatewayToken,
		UserIDHeader:    uuid.New().String(),
	})
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if p.called {
		t.Fatal("handler reached despite failed lookup")
	}
}

// POST /v1/auth/identity creates the user, so it cannot require a pre-existing
// one — but it must still require the gateway bearer.
func TestGatewayOnlyPathAllowsMissingUserButNotMissingBearer(t *testing.T) {
	users := &fakeUsers{live: map[uuid.UUID]bool{}}

	t.Run("bearer only is accepted", func(t *testing.T) {
		h, p := newStack(t, users, false)
		rec := do(h, http.MethodPost, "/v1/auth/identity", map[string]string{
			"Authorization": "Bearer " + gatewayToken,
		})
		if rec.Code != http.StatusOK || !p.called {
			t.Fatalf("status=%d called=%v; first sign-in must be reachable", rec.Code, p.called)
		}
		if p.userID != uuid.Nil {
			t.Fatalf("context user = %s, want nil for an unauthenticated sign-in", p.userID)
		}
	})

	t.Run("no bearer is refused", func(t *testing.T) {
		h, p := newStack(t, users, false)
		rec := do(h, http.MethodPost, "/v1/auth/identity", nil)
		if rec.Code != http.StatusUnauthorized || p.called {
			t.Fatalf("status=%d called=%v; the identity endpoint is not public", rec.Code, p.called)
		}
	})

	t.Run("a supplied user id is still validated", func(t *testing.T) {
		h, p := newStack(t, users, false)
		rec := do(h, http.MethodPost, "/v1/auth/identity", map[string]string{
			"Authorization": "Bearer " + gatewayToken,
			UserIDHeader:    uuid.New().String(), // not live
		})
		if rec.Code != http.StatusUnauthorized || p.called {
			t.Fatalf("status=%d called=%v; a bogus user id must not pass through", rec.Code, p.called)
		}
	})
}

// The dev escape hatch drops the bearer requirement but must NOT drop the
// user-id requirement — otherwise local development runs against a shape the
// handlers never see in production.
func TestAllowNoAuthStillRequiresAValidUser(t *testing.T) {
	live := uuid.New()
	users := &fakeUsers{live: map[uuid.UUID]bool{live: true}}

	h, p := newStack(t, users, true)
	if rec := do(h, http.MethodGet, "/v1/me", map[string]string{UserIDHeader: live.String()}); rec.Code != http.StatusOK || !p.called {
		t.Fatalf("no-auth mode with a live user: status=%d called=%v", rec.Code, p.called)
	}

	h2, p2 := newStack(t, users, true)
	if rec := do(h2, http.MethodGet, "/v1/me", nil); rec.Code != http.StatusUnauthorized || p2.called {
		t.Fatalf("no-auth mode without a user id: status=%d called=%v", rec.Code, p2.called)
	}
}

// An empty configured token must reject everything rather than accept
// everything — postclaw's tokenMatch returned true when expected was "".
func TestEmptyConfiguredTokenRejectsAll(t *testing.T) {
	live := uuid.New()
	users := &fakeUsers{live: map[uuid.UUID]bool{live: true}}
	h := RequireUser(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("handler reached with no configured gateway token")
	}), "", users, false)

	rec := do(h, http.MethodGet, "/v1/me", map[string]string{
		"Authorization": "Bearer ", UserIDHeader: live.String()})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestUserIDHelpers(t *testing.T) {
	if _, ok := UserID(context.Background()); ok {
		t.Fatal("empty context should have no user")
	}
	if _, ok := UserID(WithUserID(context.Background(), uuid.Nil)); ok {
		t.Fatal("nil uuid must not count as a user")
	}
	id := uuid.New()
	got, ok := UserID(WithUserID(context.Background(), id))
	if !ok || got != id {
		t.Fatalf("UserID = (%s, %v)", got, ok)
	}
}
