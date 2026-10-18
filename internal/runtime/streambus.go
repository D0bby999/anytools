package runtime

import (
	"sync"

	"github.com/google/uuid"
)

// subscriberBuffer is how many events a slow subscriber may fall behind before
// it is dropped. A dropped subscriber sees its connection close and reconnects
// with after_seq, which is the gap-free path Spike D measured; stalling the
// producer instead would let one wedged browser tab freeze the model's output.
const subscriberBuffer = 512

// StreamBus is ONE turn's event log plus its live subscribers. Ported from
// spikes/stream/hub.go, which was itself the port of DeepTutor's
// runtime/stream_bus.py:31 (subscribe(after_seq) at :79-90).
//
// The resume contract lives here, not in the HTTP layer:
//
//   - Emit assigns seq = nextSeq++ under the lock and appends to the log BEFORE
//     fanning out, so the log is always a superset of what any subscriber saw.
//   - Subscribe(afterSeq) snapshots log[afterSeq:] and registers the channel in
//     the SAME critical section. An Emit racing a Subscribe therefore lands
//     either entirely in the replay slice or entirely in the channel — never
//     both (a duplicate) and never neither (a gap).
//
// That single critical section is the whole design. Snapshot-then-register as
// two steps loses events emitted between them; register-then-snapshot delivers
// them twice.
type StreamBus struct {
	turnID    uuid.UUID
	sessionID uuid.UUID

	mu      sync.Mutex
	log     []Event
	nextSeq int64
	subs    map[chan Event]struct{}
	closed  bool

	// onEmit runs inside Emit, after seq is assigned, still under the lock. It
	// is the persistence hook and must not block: the sink buffers and flushes
	// on its own goroutine.
	onEmit func(Event)
}

// NewStreamBus returns an empty bus for one turn.
//
// seq starts at 1. seq 0 means "I have nothing", which is what a fresh client
// sends as after_seq — so a bus that numbered from 0 would make the first event
// unrequestable.
func NewStreamBus(turnID, sessionID uuid.UUID) *StreamBus {
	return &StreamBus{
		turnID:    turnID,
		sessionID: sessionID,
		nextSeq:   1,
		subs:      map[chan Event]struct{}{},
	}
}

// OnEmit installs the persistence hook. Called once, before any producer runs.
func (b *StreamBus) OnEmit(fn func(Event)) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.onEmit = fn
}

// Emit stamps seq, session and turn ids and a timestamp, appends to the log,
// and fans out. It returns the stamped event so a caller can read the seq it
// was given.
//
// Emitting after a terminal event is a no-op with seq 0: the stream has ended
// and appending to it would produce events no client can ever be told about.
func (b *StreamBus) Emit(ev Event) Event {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return Event{}
	}

	ev.Seq = b.nextSeq
	b.nextSeq++
	if ev.Timestamp == 0 {
		ev.Timestamp = nowUnix()
	}
	if ev.TurnID == "" {
		ev.TurnID = b.turnID.String()
	}
	if ev.SessionID == "" && b.sessionID != uuid.Nil {
		ev.SessionID = b.sessionID.String()
	}
	b.log = append(b.log, ev)

	for ch := range b.subs {
		select {
		case ch <- ev:
		default:
			close(ch)
			delete(b.subs, ch)
		}
	}

	if b.onEmit != nil {
		b.onEmit(ev)
	}

	if IsTerminal(ev.Type) {
		b.closed = true
		for ch := range b.subs {
			close(ch)
			delete(b.subs, ch)
		}
	}
	return ev
}

// Subscribe returns everything after `afterSeq` that already happened, plus a
// channel carrying everything emitted from this instant on. cancel() detaches.
//
// A nil live channel means the turn already ended; `replay` still holds its
// tail, terminal event included, so a client that connects late is told the
// turn is over rather than hanging on an open stream.
func (b *StreamBus) Subscribe(afterSeq int64) (replay []Event, live <-chan Event, cancel func()) {
	b.mu.Lock()
	defer b.mu.Unlock()

	for _, ev := range b.log {
		if ev.Seq > afterSeq {
			replay = append(replay, ev)
		}
	}
	if b.closed {
		return replay, nil, func() {}
	}

	ch := make(chan Event, subscriberBuffer)
	b.subs[ch] = struct{}{}
	return replay, ch, func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		if _, ok := b.subs[ch]; ok {
			delete(b.subs, ch)
			close(ch)
		}
	}
}

// Closed reports whether a terminal event has been emitted.
func (b *StreamBus) Closed() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.closed
}

// LastSeq returns the highest seq emitted so far.
func (b *StreamBus) LastSeq() int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.nextSeq - 1
}

// BusRegistry maps a turn id to its live bus so a reconnect finds the same log
// and a cancel request finds the running turn.
//
// This is process-local state, and it is why docs/architecture.md pins the API
// to one replica (red-team Assumption 6). A second replica would put a user's
// stream on one process and their cancel on the other. The lease + sweeper in
// recovery.go are the precondition for ever raising that number: with them, a
// turn whose bus lives in a dead process is failed rather than orphaned.
type BusRegistry struct {
	mu    sync.Mutex
	buses map[uuid.UUID]*busEntry
}

type busEntry struct {
	bus    *StreamBus
	cancel func()
	answer chan Answer
}

// Answer is one reply to an ask_user question.
//
// QuestionID is the id the `wait_for_input` event carried. It is optional on
// the wire — a client that does not echo it is still served — but when present
// it is what stops a duplicate or late POST from being consumed by a LATER
// question, which from the server's side is indistinguishable from that
// question's real answer.
type Answer struct {
	QuestionID string
	Text       string
}

// NewBusRegistry returns an empty registry.
func NewBusRegistry() *BusRegistry {
	return &BusRegistry{buses: map[uuid.UUID]*busEntry{}}
}

// Add registers a running turn's bus together with the func that cancels its
// context and the channel an ask_user answer is delivered on.
func (r *BusRegistry) Add(turnID uuid.UUID, bus *StreamBus, cancel func(), answer chan Answer) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.buses[turnID] = &busEntry{bus: bus, cancel: cancel, answer: answer}
}

// Remove drops a finished turn.
func (r *BusRegistry) Remove(turnID uuid.UUID) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.buses, turnID)
}

// Get returns the live bus for a turn, if this process is running it.
func (r *BusRegistry) Get(turnID uuid.UUID) (*StreamBus, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.buses[turnID]
	if !ok {
		return nil, false
	}
	return e.bus, true
}

// Cancel cancels a locally running turn's context. It reports whether the turn
// was found here; a turn running in a process that has since died is not, and
// the caller still writes `cancelled` to the row.
func (r *BusRegistry) Cancel(turnID uuid.UUID) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.buses[turnID]
	if !ok {
		return false
	}
	e.cancel()
	return true
}

// Answer delivers an ask_user answer to a turn parked in waiting_user. It
// reports whether the turn was running here and took delivery.
//
// Taking delivery is not the same as resuming: an answer addressed to a
// question that has already closed is accepted by the channel and then
// discarded by TurnContext.Ask, which is where the question id is known.
func (r *BusRegistry) Answer(turnID uuid.UUID, answer Answer) bool {
	r.mu.Lock()
	entry, ok := r.buses[turnID]
	r.mu.Unlock()
	if !ok || entry.answer == nil {
		return false
	}
	select {
	case entry.answer <- answer:
		return true
	default:
		// The buffer is full: an answer is already in flight for this turn.
		return false
	}
}
