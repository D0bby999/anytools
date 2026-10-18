package knowledge

import (
	"sync"
	"time"

	"github.com/google/uuid"
)

// Event is one thing that happened to a document.
//
// The wire shape is settled here, in phase 5, even though nothing streams it
// yet: `GET /v1/kb/{id}/documents` returns the same fields as a poll, and the
// merge with phase 6 adds `GET /v1/kb/{id}/events` on top of this publisher
// without changing what a client parses.
type Event struct {
	// Seq is monotonic per subscription and starts at 1. Phase 6's SSE
	// primitive puts it in `id:` so a client can resume with Last-Event-ID.
	Seq int64 `json:"seq"`
	// Type is "document.status" or "document.fallback".
	Type       string    `json:"type"`
	KBID       uuid.UUID `json:"kb_id"`
	DocumentID uuid.UUID `json:"document_id"`
	Status     string    `json:"status,omitempty"`
	// ProcessedBy is carried on every event, not only on the terminal one, so
	// a fallback is visible while the document is still being worked on.
	ProcessedBy *ProcessedBy `json:"processed_by,omitempty"`
	Message     string       `json:"message,omitempty"`
	At          time.Time    `json:"at"`
}

const (
	// EventDocumentStatus is a lifecycle transition.
	EventDocumentStatus = "document.status"
	// EventDocumentFallback is a provider downgrade: the lane that was asked
	// first gave up and the next one is being tried. RT-14 requires the user
	// to see this.
	EventDocumentFallback = "document.fallback"
)

// subscriberBuffer is how many events a slow subscriber may fall behind by.
const subscriberBuffer = 64

type subscription struct {
	userID uuid.UUID
	kbID   uuid.UUID
	ch     chan Event
	seq    int64
}

// Events is an in-process fan-out of document events, keyed by user.
//
// In-process is a deliberate, documented limit, not an oversight:
// docs/architecture.md pins the API to one replica precisely because this and
// the phase 6 stream bus are process-local. Making this durable is a different
// design (a per-document event log in Postgres) and the reason it is not needed
// yet is that a client that misses events can always re-poll
// `GET /v1/kb/{id}/documents`, which reads the same truth from the database.
type Events struct {
	mu   sync.Mutex
	next int
	subs map[int]*subscription
}

// NewEvents returns an empty publisher.
func NewEvents() *Events { return &Events{subs: map[int]*subscription{}} }

// Subscribe returns a channel of events for one user's knowledge base and a
// function that closes it.
//
// The caller MUST call the returned function; it is the only thing that removes
// the subscription, and a leaked one makes every future publish copy into a
// channel nobody reads.
func (e *Events) Subscribe(userID, kbID uuid.UUID) (<-chan Event, func()) {
	e.mu.Lock()
	defer e.mu.Unlock()

	id := e.next
	e.next++
	sub := &subscription{userID: userID, kbID: kbID, ch: make(chan Event, subscriberBuffer)}
	e.subs[id] = sub

	return sub.ch, func() {
		e.mu.Lock()
		defer e.mu.Unlock()
		if s, ok := e.subs[id]; ok {
			delete(e.subs, id)
			close(s.ch)
		}
	}
}

// Publish delivers an event to that user's subscribers of that KB.
//
// The user id is matched as well as the KB id. The KB id alone would be enough
// in a correct system — a KB belongs to one user — but this is a fan-out that
// phase 6 will expose over a network connection, and "enough in a correct
// system" is the property that stops holding first.
//
// A subscriber whose buffer is full is SKIPPED, never waited for. Blocking here
// would let one stalled browser tab hold up the parse worker that published the
// event; the skipped client re-polls and sees the truth.
func (e *Events) Publish(userID uuid.UUID, ev Event) {
	if ev.At.IsZero() {
		ev.At = time.Now().UTC()
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, sub := range e.subs {
		if sub.userID != userID || sub.kbID != ev.KBID {
			continue
		}
		sub.seq++
		ev.Seq = sub.seq
		select {
		case sub.ch <- ev:
		default:
		}
	}
}

// PublishStatus is the common case.
func (e *Events) PublishStatus(userID, kbID, docID uuid.UUID, status, message string, pb *ProcessedBy) {
	e.Publish(userID, Event{
		Type:        EventDocumentStatus,
		KBID:        kbID,
		DocumentID:  docID,
		Status:      status,
		Message:     message,
		ProcessedBy: pb,
	})
}

// PublishFallback records a provider downgrade.
func (e *Events) PublishFallback(userID, kbID, docID uuid.UUID, from, to, cause string) {
	e.Publish(userID, Event{
		Type:       EventDocumentFallback,
		KBID:       kbID,
		DocumentID: docID,
		Message:    from + " could not read this document (" + cause + "); trying " + to,
	})
}

// SubscriberCount is for tests and diagnostics.
func (e *Events) SubscriberCount() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.subs)
}
