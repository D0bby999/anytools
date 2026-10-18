package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/authapi"
	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/auth"
	"github.com/D0bby999/anytools/internal/store"
)

const testGatewayToken = "structural-test-token"

// stubUsers is a live user store, not a no-op. Building the mux with a nil Auth
// handler would leave /v1/me and /v1/auth/identity UNREGISTERED, and the 401 the
// authentication test asserts would be the middleware refusing an unknown path —
// a test that passes just as happily when the handlers are broken or absent.
type stubUsers struct{ live uuid.UUID }

func (s stubUsers) UserExists(_ context.Context, id uuid.UUID) (bool, error) {
	return id == s.live, nil
}

func (s stubUsers) GetUser(_ context.Context, id uuid.UUID) (*store.User, error) {
	if id != s.live {
		return nil, store.ErrUserNotFound
	}
	return &store.User{ID: s.live, Email: "stub@example.test", DisplayName: "Stub"}, nil
}

func (s stubUsers) UpsertIdentity(_ context.Context, c store.IdentityClaims, _ uuid.UUID) (*store.User, error) {
	return &store.User{ID: s.live, Email: c.Email, DisplayName: c.DisplayName}, nil
}

func buildTestMux(t *testing.T) (http.Handler, uuid.UUID) {
	t.Helper()
	users := stubUsers{live: uuid.New()}
	return BuildMux(Deps{
		Auth:         authapi.NewHandler(auth.NewService(users), users),
		Users:        users,
		GatewayToken: testGatewayToken,
	}), users.live
}

// Every route the API registers must sit behind RequireUser unless it is one of
// the two explicitly declared exceptions. This is the test RT-3 asks for: an
// authenticated-by-default mux where escaping requires editing a named list
// that a reviewer will see in the diff, not merely registering a handler
// somewhere else.
func TestEveryRouteIsAuthenticated(t *testing.T) {
	handler, liveUser := buildTestMux(t)

	for _, pattern := range RegisteredPatterns() {
		method, path := splitPattern(t, pattern)

		t.Run(pattern, func(t *testing.T) {
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest(method, path, nil))

			switch {
			case httpx.AllowlistedPaths[pattern]:
				if rec.Code == http.StatusUnauthorized {
					t.Fatalf("%s is allowlisted but answered 401", pattern)
				}
			case httpx.GatewayOnlyPaths[pattern]:
				// No bearer supplied above, so even a gateway-only route must
				// refuse: these are user-optional, never auth-optional.
				if rec.Code != http.StatusUnauthorized {
					t.Fatalf("%s answered %d without a bearer, want 401", pattern, rec.Code)
				}
			default:
				if rec.Code != http.StatusUnauthorized {
					t.Fatalf("%s answered %d to an unauthenticated request, want 401 — "+
						"it is registered outside the RequireUser chokepoint", pattern, rec.Code)
				}
			}
		})
	}

	// The other half, and the half a nil-Auth mux could never prove: WITH
	// credentials the route reaches a real handler. Without this, every 401
	// above is satisfied by a route that does not exist.
	t.Run("credentials reach a real handler", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
		req.Header.Set("Authorization", "Bearer "+testGatewayToken)
		req.Header.Set(httpx.UserIDHeader, liveUser.String())

		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("GET /v1/me with valid credentials = %d, want 200 (body %s)", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), liveUser.String()) {
			t.Fatalf("handler did not answer for the authenticated user: %s", rec.Body.String())
		}
	})
}

// A method the mux does not register must not inherit an exemption written for
// a different method on the same path.
func TestExemptionsDoNotLeakAcrossMethods(t *testing.T) {
	handler, _ := buildTestMux(t)

	for _, tc := range []struct{ method, path string }{
		{http.MethodPost, "/health"},          // allowlisted only for GET
		{http.MethodGet, "/v1/auth/identity"}, // gateway-only for POST
		{http.MethodDelete, "/health"},
	} {
		name := tc.method + " " + tc.path
		t.Run(name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))

			if rec.Code == http.StatusOK {
				t.Fatalf("%s answered 200 — it inherited an exemption meant for another method", name)
			}
		})
	}
}

// The exception lists are the security-relevant surface, so their contents are
// pinned. Growing either one should require deleting an assertion here.
func TestExceptionListsAreExactlyAsDeclared(t *testing.T) {
	wantAllowlist := map[string]bool{"GET /health": true}
	if len(httpx.AllowlistedPaths) != len(wantAllowlist) {
		t.Fatalf("AllowlistedPaths = %v, want %v", keys(httpx.AllowlistedPaths), keys(wantAllowlist))
	}
	for p := range wantAllowlist {
		if !httpx.AllowlistedPaths[p] {
			t.Fatalf("%s missing from AllowlistedPaths", p)
		}
	}

	wantGatewayOnly := map[string]bool{"POST /v1/auth/identity": true}
	if len(httpx.GatewayOnlyPaths) != len(wantGatewayOnly) {
		t.Fatalf("GatewayOnlyPaths = %v, want %v", keys(httpx.GatewayOnlyPaths), keys(wantGatewayOnly))
	}
	for p := range wantGatewayOnly {
		if !httpx.GatewayOnlyPaths[p] {
			t.Fatalf("%s missing from GatewayOnlyPaths", p)
		}
	}
}

// RegisteredPatterns is hand-maintained because net/http's ServeMux does not
// expose its routing table. This test scans the package source for mux
// registrations so the list cannot silently fall behind — a route registered
// but not declared is exactly the route that would ship unreviewed.
func TestRegisteredPatternsMatchesSource(t *testing.T) {
	declared := map[string]bool{}
	for _, p := range RegisteredPatterns() {
		declared[p] = true
	}

	found := scanSourceForRegistrations(t, "..")
	if len(found) == 0 {
		t.Fatal("scanner found no mux registrations — the scanner itself is broken")
	}

	for pattern := range found {
		if !declared[pattern] {
			t.Errorf("route %q is registered in source but missing from RegisteredPatterns(); "+
				"add it there so the authentication test covers it", pattern)
		}
	}
	for pattern := range declared {
		if !found[pattern] {
			t.Errorf("RegisteredPatterns() declares %q but no source registers it", pattern)
		}
	}
}

var registrationRE = regexp.MustCompile(`mux\.(?:HandleFunc|Handle)\(\s*"([^"]+)"`)

// scanSourceForRegistrations walks the internal/api tree for mux.HandleFunc /
// mux.Handle calls with a literal pattern.
func scanSourceForRegistrations(t *testing.T, root string) map[string]bool {
	t.Helper()
	found := map[string]bool{}

	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, m := range registrationRE.FindAllStringSubmatch(string(src), -1) {
			found[m[1]] = true
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk source: %v", err)
	}
	return found
}

func splitPattern(t *testing.T, pattern string) (method, path string) {
	t.Helper()
	parts := strings.Fields(pattern)
	if len(parts) != 2 {
		t.Fatalf("pattern %q must be \"METHOD /path\"", pattern)
	}
	return parts[0], parts[1]
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestHealthReportsNothingButLiveness(t *testing.T) {
	handler, _ := buildTestMux(t)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"status":"ok"`) {
		t.Fatalf("unexpected health body: %s", body)
	}
	// Anything that can reach the port reads this response; it must not become
	// a place to publish version or database details.
	for _, leak := range []string{"version", "dsn", "postgres", "database", "token"} {
		if strings.Contains(strings.ToLower(body), leak) {
			t.Fatalf("health body leaks %q: %s", leak, body)
		}
	}
}

// A panic in any handler must become a 500, not a process exit that drops every
// live SSE client (phase 5) with it.
func TestPanicBecomes500(t *testing.T) {
	panicking := http.NewServeMux()
	panicking.HandleFunc("/boom", func(http.ResponseWriter, *http.Request) { panic("boom") })

	handler := httpx.Recover(panicking)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/boom", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}
