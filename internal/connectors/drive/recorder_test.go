package drive

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// recorder_test.go — the recorded-HTTP harness, ported from spikes/drive.
//
// No live credentials exist for this connector and none are needed: the bytes
// in testdata/ are the bytes Google's REST API returns, captured from its own
// documentation, and every Drive behaviour this package claims is asserted
// against them. The owner has not created the GCP project yet
// (reports/spike-drive.md is BLOCKED on exactly that), so a test suite that
// needed a real Google account would be a test suite that never ran.
//
// Sequential BY DESIGN. These flows are sequential — page 1 then page 2, 410
// then getStartPageToken — and a map-keyed stub server would silently pass a
// client that fetched the pages in the wrong order or skipped one entirely.

type step struct {
	name string
	// wantPath is the exact request path, e.g. "/changes/startPageToken".
	wantPath string
	// check asserts on the query string, headers and body.
	check func(t *testing.T, r *http.Request)
	// One of file (read from testdata/) or body.
	file   string
	body   string
	status int
	ctype  string
}

type recorder struct {
	t     *testing.T
	mu    sync.Mutex
	steps []step
	n     int
	srv   *httptest.Server
}

func newRecorder(t *testing.T, steps ...step) *recorder {
	t.Helper()
	rec := &recorder{t: t, steps: steps}
	rec.srv = httptest.NewServer(http.HandlerFunc(rec.serve))
	t.Cleanup(rec.srv.Close)
	return rec
}

func (rec *recorder) URL() string { return rec.srv.URL }

func (rec *recorder) serve(w http.ResponseWriter, r *http.Request) {
	rec.mu.Lock()
	defer rec.mu.Unlock()
	t := rec.t

	if rec.n >= len(rec.steps) {
		t.Errorf("unexpected extra request #%d: %s %s", rec.n+1, r.Method, r.URL.RequestURI())
		http.Error(w, "unexpected request", http.StatusTeapot)
		rec.n++
		return
	}
	s := rec.steps[rec.n]
	rec.n++

	if r.URL.Path != s.wantPath {
		t.Errorf("request #%d (%s): path = %q, want %q", rec.n, s.name, r.URL.Path, s.wantPath)
	}
	if s.check != nil {
		s.check(t, r)
	}

	status := s.status
	if status == 0 {
		status = http.StatusOK
	}
	ctype := s.ctype
	if ctype == "" {
		ctype = "application/json; charset=UTF-8"
	}
	body := []byte(s.body)
	if s.file != "" {
		b, err := os.ReadFile(filepath.Join("testdata", s.file))
		if err != nil {
			t.Fatalf("fixture %s: %v", s.file, err)
		}
		body = b
	}
	w.Header().Set("Content-Type", ctype)
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// done asserts every declared call actually happened — a client that skips the
// second page must fail, not quietly pass.
func (rec *recorder) done() {
	rec.t.Helper()
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if rec.n != len(rec.steps) {
		rec.t.Errorf("made %d requests, expected %d (next unmade: %s)",
			rec.n, len(rec.steps), rec.steps[min(rec.n, len(rec.steps)-1)].name)
	}
}

// testClient points the Drive client at the recorder.
func testClient(rec *recorder) *Client {
	return NewClient(rec.URL(), func(ctx context.Context) (string, error) {
		return "test-access-token", nil
	})
}

func wantQuery(t *testing.T, r *http.Request, key, want string) {
	t.Helper()
	if got := r.URL.Query().Get(key); got != want {
		t.Errorf("query %s = %q, want %q", key, got, want)
	}
}

func wantAuthorized(t *testing.T, r *http.Request) {
	t.Helper()
	if got := r.Header.Get("Authorization"); got != "Bearer test-access-token" {
		t.Errorf("Authorization = %q, want the bearer token", got)
	}
}

func formOf(t *testing.T, r *http.Request) url.Values {
	t.Helper()
	if err := r.ParseForm(); err != nil {
		t.Fatalf("ParseForm: %v", err)
	}
	return r.PostForm
}
