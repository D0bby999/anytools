// Package builtin is what a server-run engine has in common, whatever it does
// (up-methods phase 21: Whisper for transcription; phase 22: Kokoro for
// speech).
//
// A built-in engine is the one approved exception to "no platform compute":
// a compose service on the internal network, no third-party key, metered per
// learner. Three things are the same for every such engine, so they live here
// once:
//
//   - whether it is there at all: the operator set its URL and GET
//     {url}/health answers (Engine.Available, cached for a short while so a
//     page view does not cost a round trip each time);
//   - how fast it works on this server (Engine.Observe and Engine.Speed), so
//     an estimate is "about N minutes" from what it actually measured;
//   - how much of it each learner may use per local day (Usage, implemented
//     by pg.EngineUsage over a per-engine table: stt_usage, tts_usage).
//
// It does NOT decide which learner's job runs next. One built-in job at a
// time is a job-queue property (a dedicated worker for the engine's job kind,
// internal/app), because only the queue knows what is waiting.
package builtin

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Usage is one engine's daily allowance per learner. Units are the engine's
// own (seconds of audio for transcription). day is the learner's local day,
// "YYYY-MM-DD" (learning.LocalDay(...).String()).
type Usage interface {
	// Spend takes amount from the day's allowance in one statement, and
	// reports false (spending nothing) when it would exceed limit.
	Spend(ctx context.Context, userID uuid.UUID, day string, amount, limit int) (bool, error)
	// Refund gives back what a job charged and never used. Never below zero.
	Refund(ctx context.Context, userID uuid.UUID, day string, amount int) error
	// Spent is what the learner has used on day.
	Spent(ctx context.Context, userID uuid.UUID, day string) (int, error)
}

// healthTTL is how long one health answer stands. Short: an engine that went
// away should stop being offered within a page reload or two.
const healthTTL = 30 * time.Second

// healthTimeout bounds the probe. A health check that waits is itself the
// answer: an engine too busy to say "ok" will not transcribe soon either.
const healthTimeout = 3 * time.Second

// Engine is one built-in service, as the API sees it.
type Engine struct {
	url string
	// ready is a second path that must answer 2xx: the model the API will
	// ask for is present (speaches downloads models on request, and an
	// engine without its model is healthy and useless).
	ready string
	hc    *http.Client
	now   func() time.Time

	mu        sync.Mutex
	checkedAt time.Time
	healthy   bool
	speed     float64
}

// New describes the engine at url ("http://stt:8000"; empty means the operator
// did not configure one, and the engine is never available). initialSpeed is
// work units per wall second before anything was measured: a conservative
// guess, replaced by the first real job. timeout bounds one call to it.
func New(url string, initialSpeed float64, timeout time.Duration) *Engine {
	return &Engine{
		url:   strings.TrimRight(strings.TrimSpace(url), "/"),
		hc:    InternalClient(timeout),
		now:   time.Now,
		speed: initialSpeed,
	}
}

// URL is the engine's base, without a trailing slash.
func (e *Engine) URL() string {
	if e == nil {
		return ""
	}
	return e.url
}

// WithReadyPath adds a path that must answer 2xx besides /health.
func (e *Engine) WithReadyPath(path string) *Engine {
	e.ready = path
	return e
}

// Client is the HTTP client calls to the engine use.
func (e *Engine) Client() *http.Client { return e.hc }

// Configured reports whether the operator set a URL.
func (e *Engine) Configured() bool { return e != nil && e.url != "" }

// Available reports whether the engine is configured and its /health (and
// its ready path, if any) answered 2xx within the last healthTTL. A nil
// Engine is never available.
func (e *Engine) Available(ctx context.Context) bool {
	if !e.Configured() {
		return false
	}
	e.mu.Lock()
	if !e.checkedAt.IsZero() && e.now().Sub(e.checkedAt) < healthTTL {
		ok := e.healthy
		e.mu.Unlock()
		return ok
	}
	e.mu.Unlock()

	ok := e.probe(ctx)
	e.mu.Lock()
	e.checkedAt, e.healthy = e.now(), ok
	e.mu.Unlock()
	return ok
}

func (e *Engine) probe(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, healthTimeout)
	defer cancel()
	if !e.get(ctx, "/health") {
		return false
	}
	return e.ready == "" || e.get(ctx, e.ready)
}

func (e *Engine) get(ctx context.Context, path string) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, e.url+path, nil)
	if err != nil {
		return false
	}
	resp, err := e.hc.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

// Forget drops the cached health answer, so the next Available asks again.
// A job whose call to the engine failed calls it: the page should stop
// offering an engine that just refused work.
func (e *Engine) Forget() {
	if e == nil {
		return
	}
	e.mu.Lock()
	e.checkedAt = time.Time{}
	e.mu.Unlock()
}

// Observe records one call: work units done (seconds of audio) in wall time.
// The speed is a moving average weighted towards the recent, so a server
// that got busier is reflected within a few jobs.
func (e *Engine) Observe(work float64, wall time.Duration) {
	if e == nil || work <= 0 || wall <= 0 {
		return
	}
	measured := work / wall.Seconds()
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.speed <= 0 {
		e.speed = measured
		return
	}
	e.speed = 0.7*e.speed + 0.3*measured
}

// Speed is work units per wall second (for Whisper: seconds of audio heard
// per second).
func (e *Engine) Speed() float64 {
	if e == nil {
		return 0
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.speed
}

// Estimate is how long work units would take at the measured speed, rounded
// up to a whole minute. Zero when the speed is unknown.
func (e *Engine) Estimate(work float64) time.Duration {
	speed := e.Speed()
	if speed <= 0 || work <= 0 {
		return 0
	}
	d := time.Duration(work / speed * float64(time.Second))
	if r := d.Truncate(time.Minute); r < d {
		return r + time.Minute
	}
	return d
}

// ErrRedirect refuses a redirect from an internal engine: it has no reason to
// send one, and following it would let the engine aim the API elsewhere.
var ErrRedirect = errors.New("builtin: the engine answered with a redirect")

// InternalClient is the client for a service the OPERATOR configured on the
// compose network. Not the SSRF-guarded BYOK client: that one refuses private
// addresses, and an internal service lives at one by design. The URL comes
// from the server's environment, never from a request, which is what makes
// this safe; it still follows no redirect.
func InternalClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return ErrRedirect
		},
	}
}
