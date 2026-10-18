package builtin_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/providers/builtin"
)

func TestAvailableNeedsAURLAndAHealthyAnswer(t *testing.T) {
	var nilEngine *builtin.Engine
	if nilEngine.Available(context.Background()) {
		t.Fatal("a nil engine is available")
	}
	if builtin.New("", 1, time.Second).Available(context.Background()) {
		t.Fatal("an unset URL is available")
	}

	var status atomic.Int32
	status.Store(200)
	var probes atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		probes.Add(1)
		if r.URL.Path != "/health" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(int(status.Load()))
	}))
	defer srv.Close()

	e := builtin.New(srv.URL+"/", 1, time.Second)
	if !e.Available(context.Background()) {
		t.Fatal("a healthy engine is not available")
	}
	// Cached: a page view does not probe again.
	_ = e.Available(context.Background())
	if probes.Load() != 1 {
		t.Fatalf("%d probes", probes.Load())
	}
	status.Store(503)
	e.Forget()
	if e.Available(context.Background()) {
		t.Fatal("an unhealthy engine is available")
	}

	srv.Close()
	e.Forget()
	if e.Available(context.Background()) {
		t.Fatal("an unreachable engine is available")
	}
}

func TestRedirectsAreRefused(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://example.com/health", http.StatusFound)
	}))
	defer srv.Close()
	if builtin.New(srv.URL, 1, time.Second).Available(context.Background()) {
		t.Fatal("a redirect counted as healthy")
	}
}

func TestSpeedIsMeasured(t *testing.T) {
	e := builtin.New("http://x", 4, time.Second)
	if got := e.Estimate(600); got != 3*time.Minute {
		t.Fatalf("estimate before measuring: %v", got)
	}
	// A slow server: 60 s of audio in 60 s.
	for i := 0; i < 20; i++ {
		e.Observe(60, time.Minute)
	}
	if s := e.Speed(); s < 0.99 || s > 1.01 {
		t.Fatalf("speed %v", s)
	}
	if got := e.Estimate(600); got != 10*time.Minute {
		t.Fatalf("estimate after measuring: %v", got)
	}
}
