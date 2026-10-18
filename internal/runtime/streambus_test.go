package runtime

import (
	"fmt"
	"sync"
	"testing"

	"github.com/google/uuid"
)

// The event set is the contract with DeepTutor and with the UI. A typo in a
// constant would be invisible until a client stopped rendering something.
func TestEventSetIsDeepTutorsVerbatim(t *testing.T) {
	want := []string{
		"stage_start", "stage_end", "thinking", "observation", "content",
		"tool_call", "tool_result", "progress", "sources", "result",
		"error", "session", "session_meta", "done", "wait_for_input",
	}
	if len(AllEventTypes) != len(want) {
		t.Fatalf("AllEventTypes has %d entries, want %d", len(AllEventTypes), len(want))
	}
	for i, w := range want {
		if AllEventTypes[i] != w {
			t.Errorf("AllEventTypes[%d] = %q, want %q", i, AllEventTypes[i], w)
		}
	}
}

// The ONE rename, and only that one. A second rename would mean the wire and
// the payload disagree in a way no reader could predict.
func TestOnlyErrorIsRenamedOnTheWire(t *testing.T) {
	if got := NameOnWire(EvError); got != "stream_error" {
		t.Fatalf("NameOnWire(error) = %q, want stream_error", got)
	}
	for _, typ := range AllEventTypes {
		if typ == EvError {
			continue
		}
		if got := NameOnWire(typ); got != typ {
			t.Errorf("NameOnWire(%q) = %q, want it unchanged", typ, got)
		}
	}
}

func TestOnlyDoneAndErrorAreTerminal(t *testing.T) {
	for _, typ := range AllEventTypes {
		want := typ == EvDone || typ == EvError
		if got := IsTerminal(typ); got != want {
			t.Errorf("IsTerminal(%q) = %v, want %v", typ, got, want)
		}
	}
}

func TestSeqStartsAtOneAndIsMonotonic(t *testing.T) {
	bus := NewStreamBus(uuid.New(), uuid.New())
	for i := 1; i <= 5; i++ {
		ev := bus.Emit(Event{Type: EvContent, Content: fmt.Sprint(i)})
		if ev.Seq != int64(i) {
			t.Fatalf("emit %d got seq %d, want %d", i, ev.Seq, i)
		}
	}
	// seq 0 means "I have nothing", so a fresh client asking for after_seq=0
	// must receive every event.
	replay, _, cancel := bus.Subscribe(0)
	defer cancel()
	if len(replay) != 5 {
		t.Fatalf("replay from 0 returned %d events, want 5", len(replay))
	}
}

// THE test the whole design exists for: a Subscribe racing a flood of Emits
// must see every event exactly once. A snapshot-then-register implementation
// drops events; a register-then-snapshot one duplicates them.
func TestReplayThenSubscribeUnderConcurrentEmits(t *testing.T) {
	// Kept under subscriberBuffer on purpose: this test is about the
	// snapshot-and-register critical section, not about the slow-consumer drop,
	// which has its own test below. Exceeding the buffer here would close the
	// channel mid-run and the gap it produced would look like the bug.
	const (
		producers = 4
		perWriter = 100
		total     = producers * perWriter
	)

	for attempt := 0; attempt < 30; attempt++ {
		bus := NewStreamBus(uuid.New(), uuid.New())

		var writers sync.WaitGroup
		start := make(chan struct{})
		for p := 0; p < producers; p++ {
			writers.Add(1)
			go func(p int) {
				defer writers.Done()
				<-start
				for i := 0; i < perWriter; i++ {
					bus.Emit(Event{Type: EvContent, Content: fmt.Sprintf("%d-%d", p, i)})
				}
			}(p)
		}

		// Subscribe from a goroutine released at the same instant as the
		// producers, so the race is real rather than arranged.
		type subscription struct {
			replay []Event
			live   <-chan Event
			cancel func()
		}
		got := make(chan subscription, 1)
		go func() {
			<-start
			replay, live, cancel := bus.Subscribe(0)
			got <- subscription{replay, live, cancel}
		}()

		close(start)
		sub := <-got
		writers.Wait()

		// cancel closes the channel; a closed buffered channel still yields
		// what is already in it, so this drains without racing the producers.
		sub.cancel()

		seen := map[int64]int{}
		for _, ev := range sub.replay {
			seen[ev.Seq]++
		}
		for ev := range sub.live {
			seen[ev.Seq]++
		}

		for seq, n := range seen {
			if n != 1 {
				t.Fatalf("attempt %d: seq %d delivered %d times (duplicate)", attempt, seq, n)
			}
		}
		if len(seen) == 0 {
			t.Fatalf("attempt %d: subscriber saw nothing at all", attempt)
		}

		// The subscriber joined mid-flight, so it need not see seq 1. But from
		// its first seq to the last emitted one there must be no hole: that is
		// the property a client resuming with after_seq depends on.
		var lowest, highest int64 = 1<<62 - 1, 0
		for seq := range seen {
			if seq < lowest {
				lowest = seq
			}
			if seq > highest {
				highest = seq
			}
		}
		for seq := lowest; seq <= highest; seq++ {
			if seen[seq] != 1 {
				t.Fatalf("attempt %d: gap at seq %d (have %d..%d)", attempt, seq, lowest, highest)
			}
		}
		if highest != total {
			t.Fatalf("attempt %d: last delivered seq %d, want %d", attempt, highest, total)
		}
	}
}

func TestSubscribeAfterTerminalReplaysTheTailAndClosesTheStream(t *testing.T) {
	bus := NewStreamBus(uuid.New(), uuid.New())
	bus.Emit(Event{Type: EvContent, Content: "one"})
	bus.Emit(Event{Type: EvDone})

	replay, live, cancel := bus.Subscribe(0)
	defer cancel()

	if live != nil {
		t.Error("a finished turn handed out a live channel; a client would wait forever")
	}
	if len(replay) != 2 || replay[1].Type != EvDone {
		t.Fatalf("replay = %+v, want the content event and the terminal done", replay)
	}
	if !bus.Closed() {
		t.Error("bus is not closed after a terminal event")
	}
	if ev := bus.Emit(Event{Type: EvContent, Content: "after the end"}); ev.Seq != 0 {
		t.Errorf("emit after terminal was accepted with seq %d; the stream has ended", ev.Seq)
	}
}

func TestSubscribeHonoursTheCursor(t *testing.T) {
	bus := NewStreamBus(uuid.New(), uuid.New())
	for i := 0; i < 6; i++ {
		bus.Emit(Event{Type: EvContent, Content: fmt.Sprint(i)})
	}

	replay, _, cancel := bus.Subscribe(4)
	defer cancel()

	if len(replay) != 2 {
		t.Fatalf("replay after cursor 4 returned %d events, want 2", len(replay))
	}
	if replay[0].Seq != 5 || replay[1].Seq != 6 {
		t.Fatalf("replay seqs = %d,%d, want 5,6", replay[0].Seq, replay[1].Seq)
	}
}

// A subscriber that stops reading must be dropped, not allowed to stall the
// producer: one wedged browser tab cannot be permitted to freeze a turn.
func TestSlowSubscriberIsDroppedRatherThanStallingTheProducer(t *testing.T) {
	bus := NewStreamBus(uuid.New(), uuid.New())
	_, live, cancel := bus.Subscribe(0)
	defer cancel()

	for i := 0; i < subscriberBuffer+50; i++ {
		bus.Emit(Event{Type: EvContent, Content: fmt.Sprint(i)})
	}

	// The channel is closed once the buffer overflows.
	drained := 0
	for range live {
		drained++
	}
	if drained > subscriberBuffer {
		t.Fatalf("drained %d events from a %d-deep buffer", drained, subscriberBuffer)
	}
	if bus.LastSeq() != int64(subscriberBuffer+50) {
		t.Fatalf("producer stalled: last seq %d, want %d", bus.LastSeq(), subscriberBuffer+50)
	}
}

func TestBusRegistryAnswerDeliversOnce(t *testing.T) {
	reg := NewBusRegistry()
	turnID := uuid.New()
	answers := make(chan Answer, 1)
	reg.Add(turnID, NewStreamBus(turnID, uuid.New()), func() {}, answers)

	if !reg.Answer(turnID, Answer{Text: "yes"}) {
		t.Fatal("first answer was refused")
	}
	if reg.Answer(turnID, Answer{Text: "no"}) {
		t.Fatal("a second answer was accepted while one is still in flight")
	}
	if got := <-answers; got.Text != "yes" {
		t.Fatalf("delivered %q, want the first answer", got.Text)
	}
	if reg.Answer(uuid.New(), Answer{Text: "hello"}) {
		t.Fatal("an answer for an unknown turn was accepted")
	}
}
