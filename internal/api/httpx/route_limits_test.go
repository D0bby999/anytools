package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestRouteClassBudgetIsPerClassAndPerUser(t *testing.T) {
	mux := http.NewServeMux()
	ok := func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }
	mux.HandleFunc("POST /v1/kb/{id}/documents", ok)
	mux.HandleFunc("POST /v1/chat/sessions/{id}/turns", ok)
	mux.HandleFunc("GET /v1/kb", ok)

	rl := NewRouteLimiter([]RouteClass{
		{Name: "upload", RPM: 1, Burst: 2, Patterns: []string{"POST /v1/kb/{id}/documents"}},
		{Name: "generate", RPM: 1, Burst: 1, Patterns: []string{"POST /v1/chat/sessions/{id}/turns"}},
	})
	defer rl.Close()
	h := rl.Middleware(mux, mux)

	do := func(user uuid.UUID, method, path string) int {
		r := httptest.NewRequest(method, path, nil)
		r = r.WithContext(WithUserID(r.Context(), user))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	alice, bob := uuid.New(), uuid.New()

	// The id in the path does not matter: the class is found by pattern.
	for i, want := range []int{200, 200, 429} {
		if got := do(alice, "POST", "/v1/kb/"+uuid.NewString()+"/documents"); got != want {
			t.Fatalf("upload %d: status %d, want %d", i, got, want)
		}
	}
	// Another class is a separate budget; another user a separate budget;
	// an unlimited route is untouched.
	if got := do(alice, "POST", "/v1/chat/sessions/x/turns"); got != 200 {
		t.Fatalf("alice's first turn after spending her upload budget: %d", got)
	}
	if got := do(bob, "POST", "/v1/kb/y/documents"); got != 200 {
		t.Fatalf("bob's upload was charged to alice: %d", got)
	}
	for i := 0; i < 5; i++ {
		if got := do(alice, "GET", "/v1/kb"); got != 200 {
			t.Fatalf("an unlimited route was limited: %d", got)
		}
	}
}
