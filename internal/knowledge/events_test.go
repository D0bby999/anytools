package knowledge_test

import (
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/knowledge"
)

// The isolation property this publisher will be judged on once phase 6 exposes
// it over a network connection: an event for one user's KB never reaches
// another user, even if they somehow hold the same KB id.
func TestEventsReachOnlyTheOwningSubscriber(t *testing.T) {
	e := knowledge.NewEvents()
	alice, bob := uuid.New(), uuid.New()
	kb, otherKB := uuid.New(), uuid.New()
	doc := uuid.New()

	aliceCh, stopA := e.Subscribe(alice, kb)
	defer stopA()
	bobCh, stopB := e.Subscribe(bob, kb) // same kb id, different user
	defer stopB()
	otherCh, stopO := e.Subscribe(alice, otherKB)
	defer stopO()

	e.PublishStatus(alice, kb, doc, knowledge.StatusReady, "", nil)

	if got := len(drain(aliceCh)); got != 1 {
		t.Fatalf("alice received %d events, want 1", got)
	}
	if got := len(drain(bobCh)); got != 0 {
		t.Fatalf("bob received %d events for alice's knowledge base", got)
	}
	if got := len(drain(otherCh)); got != 0 {
		t.Fatalf("alice's other KB received %d events", got)
	}
}

func TestSeqIsMonotonicPerSubscriber(t *testing.T) {
	e := knowledge.NewEvents()
	user, kb, doc := uuid.New(), uuid.New(), uuid.New()

	ch, stop := e.Subscribe(user, kb)
	defer stop()

	for _, s := range []string{
		knowledge.StatusQueued, knowledge.StatusParsing,
		knowledge.StatusIndexing, knowledge.StatusReady,
	} {
		e.PublishStatus(user, kb, doc, s, "", nil)
	}

	events := drain(ch)
	if len(events) != 4 {
		t.Fatalf("got %d events, want 4", len(events))
	}
	// Phase 6's SSE primitive puts Seq in `id:` so a client can resume with
	// Last-Event-ID; gaps or repeats there mean a resumed client silently
	// misses or replays a transition.
	for i, ev := range events {
		if ev.Seq != int64(i+1) {
			t.Fatalf("event %d has seq %d, want %d", i, ev.Seq, i+1)
		}
		if ev.At.IsZero() {
			t.Fatal("every event must carry a timestamp")
		}
	}
}

// A subscriber whose buffer is full must be SKIPPED, never waited for. Blocking
// here would let one stalled browser tab hold up the parse worker that
// published the event.
func TestASlowSubscriberDoesNotBlockThePublisher(t *testing.T) {
	e := knowledge.NewEvents()
	user, kb, doc := uuid.New(), uuid.New(), uuid.New()

	_, stop := e.Subscribe(user, kb) // never read
	defer stop()

	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 5000; i++ {
			e.PublishStatus(user, kb, doc, knowledge.StatusParsing, "", nil)
		}
	}()

	select {
	case <-done:
	case <-timeoutAfterSeconds(5):
		t.Fatal("publishing blocked on a subscriber that is not reading")
	}
}

func TestUnsubscribeClosesTheChannelAndStopsDelivery(t *testing.T) {
	e := knowledge.NewEvents()
	user, kb, doc := uuid.New(), uuid.New(), uuid.New()

	ch, stop := e.Subscribe(user, kb)
	if e.SubscriberCount() != 1 {
		t.Fatalf("subscriber count = %d", e.SubscriberCount())
	}
	stop()
	if e.SubscriberCount() != 0 {
		t.Fatal("stop() must remove the subscription; a leaked one is copied into forever")
	}

	// The channel is closed, so a reader's range loop ends rather than hanging.
	if _, open := <-ch; open {
		t.Fatal("the channel must be closed")
	}

	// And publishing afterwards must not panic on the closed channel.
	e.PublishStatus(user, kb, doc, knowledge.StatusReady, "", nil)

	// stop() twice is safe: an HTTP handler's defer can run after an explicit
	// call on the error path.
	stop()
}

func TestConcurrentSubscribeAndPublishIsRaceFree(t *testing.T) {
	e := knowledge.NewEvents()
	user, kb, doc := uuid.New(), uuid.New(), uuid.New()

	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ch, stop := e.Subscribe(user, kb)
			defer stop()
			for j := 0; j < 50; j++ {
				e.PublishStatus(user, kb, doc, knowledge.StatusParsing, "", nil)
			}
			drain(ch)
		}()
	}
	wg.Wait()
	if e.SubscriberCount() != 0 {
		t.Fatalf("%d subscriptions leaked", e.SubscriberCount())
	}
}

func TestFallbackEventNamesBothLanes(t *testing.T) {
	e := knowledge.NewEvents()
	user, kb, doc := uuid.New(), uuid.New(), uuid.New()
	ch, stop := e.Subscribe(user, kb)
	defer stop()

	e.PublishFallback(user, kb, doc, "gemini", "openai", "429 quota exhausted")

	events := drain(ch)
	if len(events) != 1 {
		t.Fatalf("got %d events", len(events))
	}
	ev := events[0]
	if ev.Type != knowledge.EventDocumentFallback {
		t.Fatalf("type = %q", ev.Type)
	}
	for _, want := range []string{"gemini", "openai", "429"} {
		if !contains(ev.Message, want) {
			t.Fatalf("message %q does not mention %q", ev.Message, want)
		}
	}
}

func timeoutAfterSeconds(n int) <-chan time.Time {
	return time.After(time.Duration(n) * time.Second)
}

func contains(haystack, needle string) bool { return strings.Contains(haystack, needle) }
