package sse

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The header set is not cosmetic. `no-transform` is what stops an intermediary
// gzipping and re-chunking the body, which coalesces frames and turns a live
// stream into one delivery at the end — the exact failure Spike D measured for.
func TestHeadersDisableTransformationAndBuffering(t *testing.T) {
	rec := httptest.NewRecorder()
	events := make(chan Event)
	close(events)

	Stream(rec, nil, events)

	for header, want := range map[string]string{
		"Content-Type":      "text/event-stream",
		"Cache-Control":     "no-cache, no-transform",
		"X-Accel-Buffering": "no",
	} {
		if got := rec.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
	if !strings.HasPrefix(rec.Body.String(), ": open\nretry: 2000\n\n") {
		t.Fatalf("the stream did not open with a flushed comment and retry hint: %q", rec.Body.String())
	}
}

// `id:` carries the seq. That is the entire resume mechanism: the browser
// replays the last id it saw as Last-Event-ID with no application code.
func TestFramesCarrySeqAsTheEventID(t *testing.T) {
	rec := httptest.NewRecorder()
	events := make(chan Event, 3)
	events <- Event{Seq: 1, Name: "content", Data: map[string]string{"content": "a"}}
	events <- Event{Seq: 2, Name: "content", Data: map[string]string{"content": "b"}}
	events <- Event{Seq: 3, Name: "done", Data: map[string]string{}, Terminal: true}
	close(events)

	Stream(rec, nil, events)
	body := rec.Body.String()

	for _, want := range []string{"id: 1\nevent: content\n", "id: 2\n", "id: 3\nevent: done\n"} {
		if !strings.Contains(body, want) {
			t.Errorf("missing frame %q in:\n%s", want, body)
		}
	}
}

// A terminal frame ends the stream: the writer returns without waiting for the
// channel to close, so a producer that hangs cannot hold the connection open.
func TestTerminalFrameEndsTheStream(t *testing.T) {
	rec := httptest.NewRecorder()
	events := make(chan Event, 2)
	events <- Event{Seq: 1, Name: "done", Data: map[string]string{}, Terminal: true}
	events <- Event{Seq: 2, Name: "content", Data: map[string]string{"content": "after the end"}}
	// deliberately NOT closed

	Stream(rec, nil, events)

	if strings.Contains(rec.Body.String(), "after the end") {
		t.Fatal("a frame after the terminal one was written")
	}
}

// A payload that cannot be marshalled is REPLACED, not skipped and not
// half-written. Half-written desynchronises the client's parser for every event
// after it; skipped leaves a hole in the id sequence, and a hole is precisely
// what tells a client to reconnect — which would hand it the same broken frame
// again.
func TestUnmarshallableFrameIsReplacedNotSkipped(t *testing.T) {
	rec := httptest.NewRecorder()
	events := make(chan Event, 2)
	events <- Event{Seq: 1, Name: "content", Data: make(chan int)} // channels do not marshal
	events <- Event{Seq: 2, Name: "done", Data: map[string]string{}, Terminal: true}
	close(events)

	Stream(rec, nil, events)
	body := rec.Body.String()

	if !strings.Contains(body, "id: 1") {
		t.Fatalf("the id sequence skipped a frame, which reads to a client as a gap:\n%s", body)
	}
	if !strings.Contains(body, "could not be encoded") {
		t.Fatalf("the broken frame was not replaced with a readable placeholder:\n%s", body)
	}
	if !strings.Contains(body, "id: 2") {
		t.Fatalf("the stream did not continue past the broken frame:\n%s", body)
	}
	// Every frame is still a complete, parseable SSE record.
	for _, chunk := range strings.Split(strings.TrimSpace(body), "\n\n") {
		if strings.HasPrefix(chunk, ":") {
			continue
		}
		if !strings.Contains(chunk, "data: ") {
			t.Fatalf("a frame was written without a data line:\n%q", chunk)
		}
	}
}

// Cursor: after_seq wins over Last-Event-ID, and garbage in either is treated
// as "from the beginning" rather than as an error the client cannot recover
// from.
func TestCursorPrefersAfterSeqAndIgnoresGarbage(t *testing.T) {
	for _, tc := range []struct {
		name   string
		query  string
		header string
		want   int64
	}{
		{"neither", "", "", 0},
		{"after_seq only", "after_seq=7", "", 7},
		{"last-event-id only", "", "5", 5},
		{"after_seq wins", "after_seq=7", "5", 7},
		{"garbage after_seq falls back to the header", "after_seq=abc", "5", 5},
		{"garbage everywhere", "after_seq=abc", "xyz", 0},
		{"negative is ignored", "after_seq=-3", "", 0},
		{"whitespace is trimmed", "", "  4  ", 4},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/v1/turns/x/events?"+tc.query, nil)
			if tc.header != "" {
				r.Header.Set("Last-Event-ID", tc.header)
			}
			if got := Cursor(r); got != tc.want {
				t.Fatalf("Cursor = %d, want %d", got, tc.want)
			}
		})
	}
}

// A response writer that cannot flush must be refused loudly: streaming into a
// buffered writer looks like it works and delivers everything at the end.
type unflushable struct{ http.ResponseWriter }

func TestNonFlushingWriterIsRefused(t *testing.T) {
	rec := httptest.NewRecorder()
	events := make(chan Event)
	close(events)

	Stream(unflushable{rec}, nil, events)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 for a writer that cannot flush", rec.Code)
	}
}

// The done channel is the client-disconnect signal.
func TestClosedDoneChannelEndsTheStream(t *testing.T) {
	rec := httptest.NewRecorder()
	done := make(chan struct{})
	close(done)
	events := make(chan Event, 1)
	events <- Event{Seq: 1, Name: "content", Data: map[string]string{"content": "never sent"}}

	Stream(rec, done, events)

	if strings.Contains(rec.Body.String(), "never sent") {
		t.Fatal("the writer kept going after the client went away")
	}
}
