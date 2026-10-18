package runtime

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Content deltas wait for the timer or the byte threshold; anything else is
// durable immediately. A per-event write would be one INSERT per token.
func TestContentDeltasAreCoalescedAndOtherEventsAreNot(t *testing.T) {
	store := newFakeEventStore()
	sink := NewEventSink(store, uuid.New(), uuid.New())
	defer sink.Close()

	bus := NewStreamBus(uuid.New(), uuid.New())
	bus.OnEmit(sink.Add)

	for i := 0; i < 5; i++ {
		bus.Emit(Event{Type: EvContent, Content: "tok "})
	}
	// Small deltas, well under FlushBytes and faster than FlushInterval: none
	// of them should have reached the store yet.
	if n := len(store.all()); n != 0 {
		t.Fatalf("%d content deltas were written immediately; they should be coalesced", n)
	}

	// A non-content event forces the buffer out, deltas FIRST.
	bus.Emit(Event{Type: EvToolCall, Content: "rag_search"})
	waitFor(t, func() bool { return len(store.all()) == 6 })

	got := store.all()
	for i, ev := range got {
		if ev.Seq != int64(i+1) {
			t.Fatalf("persisted event %d has seq %d; the log must be a gap-free prefix", i, ev.Seq)
		}
	}
	if got[5].Type != EvToolCall {
		t.Fatalf("the tool_call was written before the deltas it follows: %+v", got)
	}
}

// The byte threshold catches a long answer with no tool calls punctuating it.
func TestLargeContentFlushesOnTheByteThreshold(t *testing.T) {
	store := newFakeEventStore()
	sink := NewEventSink(store, uuid.New(), uuid.New())
	defer sink.Close()

	bus := NewStreamBus(uuid.New(), uuid.New())
	bus.OnEmit(sink.Add)

	bus.Emit(Event{Type: EvContent, Content: strings.Repeat("x", FlushBytes+1)})
	waitFor(t, func() bool { return len(store.all()) == 1 })
}

// The timer is the third path: a slow trickle of tokens must still become
// durable, or a crash loses the whole answer so far.
func TestIdleDeltasFlushOnTheTimer(t *testing.T) {
	store := newFakeEventStore()
	sink := NewEventSink(store, uuid.New(), uuid.New())
	defer sink.Close()

	bus := NewStreamBus(uuid.New(), uuid.New())
	bus.OnEmit(sink.Add)
	bus.Emit(Event{Type: EvContent, Content: "one token"})

	deadline := time.Now().Add(3 * FlushInterval)
	for time.Now().Before(deadline) {
		if len(store.all()) == 1 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("a buffered delta never reached the store within %s", 3*FlushInterval)
}

// Close is the last chance: whatever is buffered when a turn ends must land.
func TestCloseFlushesWhatIsBuffered(t *testing.T) {
	store := newFakeEventStore()
	sink := NewEventSink(store, uuid.New(), uuid.New())

	bus := NewStreamBus(uuid.New(), uuid.New())
	bus.OnEmit(sink.Add)
	bus.Emit(Event{Type: EvContent, Content: "unflushed"})

	sink.Close()
	if n := len(store.all()); n != 1 {
		t.Fatalf("Close left %d events unwritten", 1-n)
	}
	sink.Close() // must be safe twice
}

// A write that fails is logged, not fatal: the in-process bus is still serving
// every attached client correctly, and failing the turn would turn a
// bookkeeping problem into a lost answer.
func TestAFailedWriteDoesNotBreakTheStream(t *testing.T) {
	store := newFakeEventStore()
	store.setFailure(errTestWrite)
	sink := NewEventSink(store, uuid.New(), uuid.New())

	bus := NewStreamBus(uuid.New(), uuid.New())
	bus.OnEmit(sink.Add)
	bus.Emit(Event{Type: EvToolCall, Content: "x"})
	bus.Emit(Event{Type: EvDone})
	sink.Close()

	if bus.LastSeq() != 2 {
		t.Fatalf("the bus stopped at seq %d when persistence failed", bus.LastSeq())
	}
}

// A transient failure must not put a permanent hole in the replay log. The
// batch goes back at the FRONT of the buffer and the next flush writes it in
// order — AppendEvents is idempotent precisely so that retry is safe.
func TestAFailedBatchIsRetriedInOrder(t *testing.T) {
	store := newFakeEventStore()
	store.setFailure(errTestWrite)
	sink := NewEventSink(store, uuid.New(), uuid.New())
	defer sink.Close()

	bus := NewStreamBus(uuid.New(), uuid.New())
	bus.OnEmit(sink.Add)

	bus.Emit(Event{Type: EvToolCall, Content: "one"})   // seq 1, flushes and fails
	bus.Emit(Event{Type: EvToolResult, Content: "two"}) // seq 2, flushes and fails
	waitFor(t, func() bool { return store.attempts() >= 2 })
	if n := len(store.all()); n != 0 {
		t.Fatalf("%d events landed while the store was failing", n)
	}

	// The database comes back.
	store.setFailure(nil)
	bus.Emit(Event{Type: EvObservation, Content: "three"}) // seq 3

	waitFor(t, func() bool { return len(store.all()) == 3 })
	got := store.all()
	for i, ev := range got {
		if ev.Seq != int64(i+1) {
			t.Fatalf("persisted log is out of order after a retry: %+v", got)
		}
	}
}

// A database that stays down must not let one turn's buffer grow without
// limit. Past the cap the OLDEST events go, keeping the tail that says how the
// turn ended.
func TestAPermanentlyFailingStoreDoesNotGrowTheBufferForever(t *testing.T) {
	store := newFakeEventStore()
	store.setFailure(errTestWrite)
	sink := NewEventSink(store, uuid.New(), uuid.New())
	defer sink.Close()

	for i := 0; i < maxPending+500; i++ {
		sink.Add(Event{Type: EvContent, Seq: int64(i + 1), Content: "x"})
	}
	sink.Flush()

	sink.mu.Lock()
	held := len(sink.pending)
	sink.mu.Unlock()

	if held > maxPending {
		t.Fatalf("buffer holds %d events, capped at %d", held, maxPending)
	}
}

var errTestWrite = errTest("write failed")

type errTest string

func (e errTest) Error() string { return string(e) }

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition never became true within 2s")
}
