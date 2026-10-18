package httpx

import (
	"log/slog"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// RateLimiter enforces a per-key token-bucket budget.
//
// Keyed by authenticated user id, so one user cannot spend another's budget.
// State is in-process, which is sound only because the API runs as exactly one
// replica (docs/architecture.md, "Single replica"). Phase 12's compose pins
// replicas: 1 for the same reason.
type RateLimiter struct {
	limiters sync.Map // key → *limiterEntry
	rate     rate.Limit
	burst    int
	stop     chan struct{}
	stopOnce sync.Once
}

type limiterEntry struct {
	limiter  *rate.Limiter
	mu       sync.Mutex
	lastSeen time.Time
}

// NewRateLimiter builds a limiter allowing rpm requests per minute with the
// given burst. rpm <= 0 disables it.
func NewRateLimiter(rpm, burst int) *RateLimiter {
	if burst <= 0 {
		burst = 5
	}
	r := rate.Limit(0)
	if rpm > 0 {
		r = rate.Limit(float64(rpm) / 60.0)
	}
	rl := &RateLimiter{rate: r, burst: burst, stop: make(chan struct{})}
	if rl.Enabled() {
		go rl.cleanupLoop()
	}
	return rl
}

// Enabled reports whether the limiter actually limits anything.
func (rl *RateLimiter) Enabled() bool { return rl.rate > 0 }

// Close stops the background cleanup goroutine.
func (rl *RateLimiter) Close() { rl.stopOnce.Do(func() { close(rl.stop) }) }

// Allow reports whether a request from key may proceed.
func (rl *RateLimiter) Allow(key string) bool {
	if !rl.Enabled() {
		return true
	}
	entry := rl.getOrCreate(key)

	// lastSeen is stamped BEFORE the verdict, not after. Stamping only on
	// success means a key that is being continuously refused stops looking
	// active, gets swept by the idle cleanup, and returns with a full fresh
	// burst — the limiter would forget precisely the caller it is limiting.
	entry.mu.Lock()
	entry.lastSeen = time.Now()
	entry.mu.Unlock()

	if !entry.limiter.Allow() {
		slog.Warn("security.rate_limited", "key", key)
		return false
	}
	return true
}

// Middleware rejects over-budget requests with 429. It must run INSIDE
// RequireUser so the key is an authenticated user id rather than a
// client-supplied header.
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	if !rl.Enabled() {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserID(r.Context())
		if !ok {
			// Allowlisted (unauthenticated) paths have no user to bill; they
			// are a fixed, tiny set and are not rate limited here.
			next.ServeHTTP(w, r)
			return
		}
		if !rl.Allow(userID.String()) {
			w.Header().Set("Retry-After", "1")
			WriteError(w, http.StatusTooManyRequests, "rate limit exceeded", "rate_limited")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (rl *RateLimiter) getOrCreate(key string) *limiterEntry {
	if v, ok := rl.limiters.Load(key); ok {
		return v.(*limiterEntry)
	}
	entry := &limiterEntry{limiter: rate.NewLimiter(rl.rate, rl.burst), lastSeen: time.Now()}
	actual, _ := rl.limiters.LoadOrStore(key, entry)
	return actual.(*limiterEntry)
}

// cleanupLoop drops idle buckets so the map does not grow once per user id
// ever seen — including ids from failed probes.
func (rl *RateLimiter) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			cutoff := time.Now().Add(-10 * time.Minute)
			rl.limiters.Range(func(k, v any) bool {
				entry := v.(*limiterEntry)
				entry.mu.Lock()
				idle := entry.lastSeen.Before(cutoff)
				entry.mu.Unlock()
				if idle {
					rl.limiters.Delete(k)
				}
				return true
			})
		case <-rl.stop:
			return
		}
	}
}
