// Package sse is AnyTools' one Server-Sent Events writer.
//
// It knows nothing about turns, chat or knowledge bases: it takes a channel of
// already-shaped events and writes the frames. Phase 6 streams turn events
// through it; phase 5's `GET /v1/kb/{id}/events` streams document status
// through the same function at merge. One writer means the header set, the
// heartbeat and the `id:` contract have one definition rather than one per
// feature.
//
// Ported from spikes/stream/sse.go, which measured the behaviour this package
// depends on (reports/spike-stream-retrieval.md §SSE): 11.9 ms median TTFB
// through the RR7 Node-adapter proxy, no buffering at a 400 ms producer, and
// gap-free resume.
package sse

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// HeartbeatInterval is how often a comment frame is written on an idle stream.
//
// Fifteen seconds is under every proxy idle timeout worth worrying about (nginx
// defaults to 60 s) and under the 30 s some mobile networks use. The frame is a
// comment, so a client parses and discards it without an event handler running.
const HeartbeatInterval = 15 * time.Second

// Event is one frame.
//
// Seq becomes the `id:` field, which is what the browser sends back as
// Last-Event-ID on an automatic reconnect — the resume cursor, for free, with
// no application code on the client.
type Event struct {
	Seq  int64
	Name string
	Data any

	// Terminal ends the stream: Stream writes the frame and returns.
	Terminal bool
}

// Cursor reads the resume position from a request.
//
// `after_seq` wins over `Last-Event-ID` because it is explicit: our own client
// sets it when it knows exactly where it stopped, while Last-Event-ID is what
// the browser replays on a reconnect we did not initiate. Honouring both is
// what makes a plain EventSource resume correctly with no application code.
func Cursor(r *http.Request) int64 {
	if v := strings.TrimSpace(r.URL.Query().Get("after_seq")); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n >= 0 {
			return n
		}
	}
	if v := strings.TrimSpace(r.Header.Get("Last-Event-ID")); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n >= 0 {
			return n
		}
	}
	return 0
}

// WriteHeaders sets the response headers and flushes them.
//
// `no-transform` is the one that matters through a proxy: without it an
// intermediary may gzip or re-chunk the body and coalesce frames, which turns a
// live stream into one delivery at the end. `X-Accel-Buffering` is
// nginx-specific and inert elsewhere (postclaw sets it for the same reason,
// internal/http/runs_sse.go:56).
//
// The open comment is written and flushed immediately so a client sees the
// response head before the first event exists; without it, TTFB measures the
// producer's scheduling rather than the handler.
func WriteHeaders(w http.ResponseWriter) (http.Flusher, bool) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return nil, false
	}

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	fmt.Fprint(w, ": open\nretry: 2000\n\n")
	flusher.Flush()
	return flusher, true
}

// Stream writes every event from the channel until it closes, the client goes
// away, or a terminal event is written.
//
// `done` is the caller's disconnect signal — in a handler, r.Context().Done().
// It is a parameter rather than a *http.Request so phase 5 can stream from a
// non-request source without inventing one.
func Stream(w http.ResponseWriter, done <-chan struct{}, events <-chan Event) {
	flusher, ok := WriteHeaders(w)
	if !ok {
		return
	}

	ticker := time.NewTicker(HeartbeatInterval)
	defer ticker.Stop()

	for {
		// Disconnect is checked FIRST, on its own. Go's select picks at random
		// among ready cases, so a single combined select would sometimes write
		// another frame to a client that has already gone — harmless on the
		// wire, but it makes "the writer stops when the client leaves" a
		// coin-flip rather than a property, and the test for it flaky.
		select {
		case <-done:
			return
		default:
		}

		select {
		case <-done:
			return

		case <-ticker.C:
			// A comment, not an event: it keeps the connection and every proxy
			// on the path awake without the client running a handler.
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()

		case ev, open := <-events:
			if !open {
				return
			}
			writeEvent(w, ev)
			flusher.Flush()
			if ev.Terminal {
				return
			}
		}
	}
}

// writeEvent emits one frame: id (the resume cursor), event (the wire name) and
// data (the JSON payload).
//
// A payload that fails to marshal is replaced rather than skipped. Skipping it
// left a permanent hole in the wire sequence: the client's next id jumps, and
// since a gap is exactly what "I missed something, reconnect" means, it would
// reconnect and be handed the same unmarshallable frame again. Sending a
// well-formed placeholder keeps the sequence dense and tells the client
// something was lost.
func writeEvent(w http.ResponseWriter, ev Event) {
	data, err := json.Marshal(ev.Data)
	if err != nil {
		slog.Error("sse: frame payload could not be encoded", "error", err, "seq", ev.Seq, "event", ev.Name)
		data = []byte(`{"type":"progress","content":"an event could not be encoded"}`)
	}
	fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", ev.Seq, ev.Name, data)
}
