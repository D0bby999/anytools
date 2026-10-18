package kbapi_test

// events_test.go — `GET /v1/kb/{id}/events`, the endpoint the merge added on
// top of phase 5's knowledge.Events and phase 6's internal/api/sse.
//
// Both tests here are about a property that is invisible from the outside if it
// is wrong: the first that a browser watching a knowledge base really sees the
// parse pipeline move, and the second that ownership is settled BEFORE the
// stream opens — a handler that refused after flushing a 200 would be reporting
// authorization inside an event body.

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/api/httpx"
)

type sseFrame struct {
	id    string
	event string
	data  map[string]any
}

// openStream opens the event stream and returns it once the server has written
// its `: open` comment — which sse.WriteHeaders does AFTER the handler has
// subscribed, so anything published from here on is guaranteed to be seen.
func openStream(t *testing.T, srv *httptest.Server, user, path string) (*bufio.Reader, func()) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+path, nil)
	if err != nil {
		cancel()
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+gatewayToken)
	req.Header.Set(httpx.UserIDHeader, user)
	req.Header.Set("Accept", "text/event-stream")

	res, err := srv.Client().Do(req)
	if err != nil {
		cancel()
		t.Fatalf("open stream: %v", err)
	}
	if res.StatusCode != http.StatusOK {
		res.Body.Close()
		cancel()
		t.Fatalf("stream status %d, want 200", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "text/event-stream" {
		res.Body.Close()
		cancel()
		t.Fatalf("content-type = %q", ct)
	}
	// no-transform is what stops a proxy coalescing frames into one delivery.
	if cc := res.Header.Get("Cache-Control"); !strings.Contains(cc, "no-transform") {
		res.Body.Close()
		cancel()
		t.Fatalf("Cache-Control = %q, want no-transform", cc)
	}

	reader := bufio.NewReader(res.Body)
	line, err := reader.ReadString('\n')
	if err != nil || !strings.HasPrefix(line, ":") {
		res.Body.Close()
		cancel()
		t.Fatalf("first line = %q (%v), want the open comment", line, err)
	}
	return reader, func() { cancel(); res.Body.Close() }
}

// readFrames reads up to n frames, skipping keepalive comments.
func readFrames(t *testing.T, r *bufio.Reader, n int) []sseFrame {
	t.Helper()
	var frames []sseFrame
	var cur sseFrame
	for len(frames) < n {
		line, err := r.ReadString('\n')
		if err != nil {
			t.Fatalf("read stream: %v (got %d frames)", err, len(frames))
		}
		line = strings.TrimRight(line, "\n")
		switch {
		case line == "":
			if cur.event != "" {
				frames = append(frames, cur)
			}
			cur = sseFrame{}
		case strings.HasPrefix(line, ":"):
			// keepalive or the open marker
		case strings.HasPrefix(line, "id: "):
			cur.id = strings.TrimPrefix(line, "id: ")
		case strings.HasPrefix(line, "event: "):
			cur.event = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &cur.data); err != nil {
				t.Fatalf("decode frame: %v", err)
			}
		}
	}
	return frames
}

// A browser watching a knowledge base sees the document move without polling.
//
// The events are published while the worker runs, into a buffered per-subscriber
// channel, so this test subscribes first and reads afterwards — which is also
// exactly what a real client does while a 19-page PDF is being read.
func TestKBEventStreamReportsTheParsePipeline(t *testing.T) {
	e := newEnv(t)
	srv := httptest.NewServer(e.handler)
	defer srv.Close()

	kbID := e.createKB(e.alice, "Streamed")
	reader, closeStream := openStream(t, srv, e.alice.String(), "/v1/kb/"+kbID.String()+"/events")
	defer closeStream()

	if rec := e.upload(e.alice, kbID, "rag.pdf", ragPDF(t)); rec.Code != http.StatusAccepted {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	e.drainJobs()

	// queued → parsing → indexing → ready.
	frames := readFrames(t, reader, 4)

	var statuses []string
	for i, f := range frames {
		if f.event != "document.status" {
			t.Fatalf("frame %d is %q, want document.status", i, f.event)
		}
		// `id:` is the resume cursor the browser replays on its own reconnect.
		// A frame without one leaves a client with nothing to resume from.
		if f.id == "" {
			t.Fatalf("frame %d carried no id", i)
		}
		if f.data["kb_id"] != kbID.String() {
			t.Fatalf("frame %d names kb %v, want %s", i, f.data["kb_id"], kbID)
		}
		statuses = append(statuses, f.data["status"].(string))
	}

	want := []string{"queued", "parsing", "indexing", "ready"}
	for i := range want {
		if statuses[i] != want[i] {
			t.Fatalf("statuses = %v, want %v", statuses, want)
		}
	}
}

// Another user's knowledge base is a 404 with a JSON body — not a 200 that
// streams nothing, and not a 403.
func TestKBEventStreamRefusesBeforeItOpens(t *testing.T) {
	e := newEnv(t)
	srv := httptest.NewServer(e.handler)
	defer srv.Close()

	kbID := e.createKB(e.alice, "Alice's")

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/v1/kb/"+kbID.String()+"/events", nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+gatewayToken)
	req.Header.Set(httpx.UserIDHeader, e.bob.String())

	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (never 403 — that is an existence oracle)", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); strings.HasPrefix(ct, "text/event-stream") {
		t.Fatal("the stream was opened before ownership was decided")
	}
	// And nothing must be left subscribed on the refused path.
	if n := e.svc.Events().SubscriberCount(); n != 0 {
		t.Fatalf("%d subscribers left behind by a refused request", n)
	}
}
