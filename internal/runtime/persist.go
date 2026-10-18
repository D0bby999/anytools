package runtime

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Coalescing thresholds for content deltas.
//
// DeepTutor buffers every event and flushes once on DONE
// (services/session/turns/lifecycle.py:626-660). That is one INSERT per turn —
// and nothing on disk if the process dies mid-turn, which is exactly the case
// the recovery sweeper exists to survive. AnyTools splits the difference:
// non-content events are durable immediately, and the high-frequency ones
// (content/thinking deltas, one per token) are batched.
const (
	FlushInterval = 500 * time.Millisecond
	FlushBytes    = 2 << 10 // 2 KB of accumulated delta content

	// maxPending caps how many events a failing database may accumulate in one
	// turn's buffer before the oldest are dropped.
	maxPending = 20_000
)

// EventSink persists a turn's events with content deltas coalesced.
//
// Ordering rule, and the reason this is not just a timer: when a non-content
// event arrives, the pending deltas are flushed FIRST, in the same batch, ahead
// of it. Writing seq 6 immediately while seq 5 sits in a buffer would leave a
// hole in the persisted log, and a client resuming from the database after a
// restart would replay 4, 6 — a gap the whole seq contract exists to prevent.
// The persisted log is therefore always a prefix of the emitted one.
type EventSink struct {
	store  EventStore
	turnID uuid.UUID
	userID uuid.UUID

	mu      sync.Mutex
	pending []Event
	bytes   int
	closed  bool

	// writeMu serialises the DATABASE writes, which s.mu deliberately does not
	// cover (it must never be held across a round trip, because Add runs under
	// the stream bus's own lock).
	//
	// Without it, two flushes can be in flight at once — the timer's and the
	// terminal one — and they commit in whatever order the database finishes
	// them. Measured: a turn whose `done` landed while the batch before it was
	// still writing left the persisted log as 1, 2, 25. A client reconnecting
	// on that `done` then replayed a log with a hole in the middle, which is
	// the one thing the seq contract exists to prevent. Taking this lock BEFORE
	// the batch is claimed also keeps batches in seq order.
	writeMu sync.Mutex

	flushNow chan struct{}
	done     chan struct{}
	wg       sync.WaitGroup
}

// NewEventSink starts the sink's flush loop. Close must be called; the
// orchestrator does it in a defer on the turn goroutine.
func NewEventSink(store EventStore, turnID, userID uuid.UUID) *EventSink {
	s := &EventSink{
		store:    store,
		turnID:   turnID,
		userID:   userID,
		flushNow: make(chan struct{}, 1),
		done:     make(chan struct{}),
	}
	s.wg.Add(1)
	go s.loop()
	return s
}

// Add is the StreamBus's onEmit hook. It runs under the bus lock, so it only
// buffers and signals — never a database round trip.
func (s *EventSink) Add(ev Event) {
	s.mu.Lock()
	s.pending = append(s.pending, ev)
	if isDelta(ev.Type) {
		s.bytes += len(ev.Content)
	}
	// A non-content event and a terminal event both mean "make the log durable
	// up to and including this one". A byte threshold covers a long answer with
	// no punctuation of tool calls in it.
	urgent := !isDelta(ev.Type) || s.bytes >= FlushBytes
	s.mu.Unlock()

	if urgent {
		select {
		case s.flushNow <- struct{}{}:
		default:
		}
	}
}

// isDelta reports whether an event type is a high-frequency token delta. Only
// these are allowed to wait for the timer.
func isDelta(t string) bool { return t == EvContent || t == EvThinking }

func (s *EventSink) loop() {
	defer s.wg.Done()
	ticker := time.NewTicker(FlushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-s.done:
			s.flush()
			return
		case <-s.flushNow:
			s.flush()
		case <-ticker.C:
			s.flush()
		}
	}
}

// flush writes the buffered batch. It uses a background context with its own
// timeout, deliberately NOT the turn's: a cancelled turn still has to record
// the events that explain why it ended, and inheriting the cancellation would
// discard exactly the tail a user needs to see.
//
// A failed write is put BACK at the front of the buffer and retried on the next
// flush. AppendEvents is idempotent (ON CONFLICT DO NOTHING on (turn_id, seq))
// precisely so that is safe. Dropping the batch instead would leave a permanent
// hole in the replay log — and a hole is worse than a delay, because a client
// resuming across it loses that text silently: it dedupes by seq and has no way
// to notice a seq that never arrives.
func (s *EventSink) flush() {
	// Claim the write slot first, THEN the batch: a flush that took the batch
	// before queuing for the slot could overtake an earlier one and commit its
	// events out of order.
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.Lock()
	if len(s.pending) == 0 {
		s.mu.Unlock()
		return
	}
	batch := s.pending
	s.pending = nil
	s.bytes = 0
	s.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := s.store.AppendEvents(ctx, s.turnID, s.userID, batch); err != nil {
		slog.Error("runtime: persist turn events",
			"error", err, "turn_id", s.turnID, "events", len(batch))
		s.requeue(batch)
	}
}

// requeue puts a failed batch back at the FRONT of the buffer, bounded.
//
// Front, because seq order is the log's whole contract. Bounded, because a
// database that stays down must not let one turn's buffer grow without limit —
// past the cap the OLDEST events are dropped, which keeps the tail (the part
// that says how the turn ended) rather than the head.
func (s *EventSink) requeue(batch []Event) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.pending = append(batch, s.pending...)
	if over := len(s.pending) - maxPending; over > 0 {
		slog.Error("runtime: dropping unpersisted turn events",
			"turn_id", s.turnID, "dropped", over)
		s.pending = s.pending[over:]
	}
	s.bytes = 0
	for _, ev := range s.pending {
		if isDelta(ev.Type) {
			s.bytes += len(ev.Content)
		}
	}
}

// Close performs the final flush and stops the loop. Safe to call twice.
func (s *EventSink) Close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	s.mu.Unlock()

	close(s.done)
	s.wg.Wait()

	// One retry on the way out. If it still fails, the events are gone and the
	// log above says so — blocking a finishing turn on a dead database would
	// hold the goroutine and the lease for as long as the outage lasts.
	s.flush()
}

// Flush forces a synchronous write of everything buffered, and waits for any
// write already in flight.
//
// The orchestrator calls it after emitting a terminal event, which is the
// moment a client is most likely to reconnect: it sees `done`, and asks for
// whatever it missed. If an earlier batch were still committing, that read
// would return a log with a hole in it.
func (s *EventSink) Flush() { s.flush() }
