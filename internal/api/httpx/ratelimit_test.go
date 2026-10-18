package httpx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestRateLimiterDisabledWhenRPMIsNotPositive(t *testing.T) {
	for _, rpm := range []int{0, -1} {
		rl := NewRateLimiter(rpm, 10)
		t.Cleanup(rl.Close)

		if rl.Enabled() {
			t.Fatalf("rpm=%d should disable the limiter", rpm)
		}
		for i := 0; i < 100; i++ {
			if !rl.Allow("user") {
				t.Fatalf("rpm=%d refused request %d while disabled", rpm, i)
			}
		}
	}
}

func TestRateLimiterSpendsThenRefusesTheBurst(t *testing.T) {
	// A very low refill rate makes the burst the whole budget for the duration
	// of the test, so the assertion does not depend on wall-clock timing.
	rl := NewRateLimiter(1, 3)
	t.Cleanup(rl.Close)

	for i := 0; i < 3; i++ {
		if !rl.Allow("user-a") {
			t.Fatalf("request %d should be within the burst of 3", i+1)
		}
	}
	if rl.Allow("user-a") {
		t.Fatal("the fourth request exceeded the burst and should be refused")
	}
}

// The budget is per user. One user exhausting theirs must not deny service to
// everyone else — which is exactly what a limiter keyed on anything shared
// (an IP behind a proxy, or a single global bucket) would do.
func TestRateLimiterBudgetsAreIndependentPerKey(t *testing.T) {
	rl := NewRateLimiter(1, 2)
	t.Cleanup(rl.Close)

	for i := 0; i < 2; i++ {
		rl.Allow("user-a")
	}
	if rl.Allow("user-a") {
		t.Fatal("user-a should be out of budget")
	}
	if !rl.Allow("user-b") {
		t.Fatal("user-b was denied by user-a's spending")
	}
}

// The limiter must key on the AUTHENTICATED user id from the context. Keying on
// a header would let a caller reset their own budget by changing one value.
func TestRateLimiterKeysOnTheContextUserNotAHeader(t *testing.T) {
	rl := NewRateLimiter(1, 1)
	t.Cleanup(rl.Close)

	reached := 0
	handler := rl.Middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached++ }))

	userID := uuid.New()
	call := func(headerID string) int {
		req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
		req.Header.Set(UserIDHeader, headerID)
		req = req.WithContext(WithUserID(req.Context(), userID))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec.Code
	}

	if code := call(userID.String()); code != http.StatusOK {
		t.Fatalf("first request: status = %d, want 200", code)
	}
	// Same context user, a different header value. If the header were the key,
	// this would be a fresh bucket and would pass.
	if code := call(uuid.New().String()); code != http.StatusTooManyRequests {
		t.Fatalf("second request: status = %d, want 429 — the limiter is keyed on a header", code)
	}
	if reached != 1 {
		t.Fatalf("handler reached %d times, want 1", reached)
	}
}

func TestRateLimitedResponseShapeIsUsable(t *testing.T) {
	rl := NewRateLimiter(1, 1)
	t.Cleanup(rl.Close)

	handler := rl.Middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	userID := uuid.New()

	var rec *httptest.ResponseRecorder
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
		req = req.WithContext(WithUserID(req.Context(), userID))
		rec = httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
	}

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rec.Code)
	}
	// Retry-After tells the BFF when to come back instead of making it guess.
	if rec.Header().Get("Retry-After") == "" {
		t.Error("429 response has no Retry-After header")
	}
	if got := rec.Body.String(); !strings.Contains(got, `"code":"rate_limited"`) {
		t.Errorf("429 body has no machine code to branch on: %s", got)
	}
}

// Requests with no user in context are the allowlisted paths (/health). They
// have nobody to bill, so they pass through rather than sharing one bucket —
// which would let anonymous traffic starve the health check.
func TestRateLimiterPassesThroughRequestsWithNoUser(t *testing.T) {
	rl := NewRateLimiter(1, 1)
	t.Cleanup(rl.Close)

	handler := rl.Middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))

	for i := 0; i < 5; i++ {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d: status = %d, want 200", i+1, rec.Code)
		}
	}
}

// A disabled limiter must not wrap the handler at all, and must not have
// started a cleanup goroutine to leak.
func TestDisabledLimiterReturnsTheHandlerUnwrapped(t *testing.T) {
	rl := NewRateLimiter(0, 0)
	t.Cleanup(rl.Close)

	inner := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	if got := rl.Middleware(inner); got == nil {
		t.Fatal("Middleware returned nil")
	}

	handler := rl.Middleware(inner)
	userID := uuid.New()
	for i := 0; i < 50; i++ {
		req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
		req = req.WithContext(WithUserID(req.Context(), userID))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("disabled limiter refused request %d", i+1)
		}
	}
}

// Close must be safe to call more than once: wire.go defers it, and a test or a
// future shutdown path may call it too. A second close of the channel would
// panic and take the process down during shutdown.
func TestCloseIsIdempotent(t *testing.T) {
	rl := NewRateLimiter(60, 5)
	rl.Close()
	rl.Close()
}

// Concurrent traffic from many users must not race on the shared map. This runs
// under -race in CI.
func TestRateLimiterIsSafeUnderConcurrentUse(t *testing.T) {
	rl := NewRateLimiter(600, 10)
	t.Cleanup(rl.Close)

	done := make(chan struct{})
	for i := 0; i < 8; i++ {
		go func(n int) {
			defer func() { done <- struct{}{} }()
			key := uuid.New().String()
			for j := 0; j < 50; j++ {
				rl.Allow(key)
				rl.Allow("shared-key")
			}
		}(i)
	}
	for i := 0; i < 8; i++ {
		<-done
	}
}
