package chatapi_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/runtime"
)

// groundedScript is the provider behaviour every grounded turn has: search
// first, then answer citing what came back.
func groundedScript() *scriptedProvider {
	return &scriptedProvider{responses: []*runtime.ChatResponse{
		{
			FinishReason: "tool_calls",
			ToolCalls: []runtime.ToolCall{{
				ID: "call-1", Name: "rag_search",
				Arguments: map[string]any{"query": "how does hybrid retrieval work"},
			}},
			Usage: &runtime.Usage{PromptTokens: 800, CompletionTokens: 40},
		},
		{
			Content: "It merges a lexical arm and a vector arm with reciprocal rank fusion " +
				"[[cite:chunk:chunk-1]].",
			FinishReason: "stop",
			Usage:        &runtime.Usage{PromptTokens: 1500, CompletionTokens: 60},
		},
	}}
}

// THE end-to-end test the phase asks for: a fake provider with scripted tool
// calls, driven through the real HTTP path, producing streamed content, a
// `sources` event and a citation the UI can turn into a chip.
func TestEndToEndGroundedTurnStreamsContentSourcesAndACitation(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, groundedScript())

	sessionID := h.createSession(t, p)
	turnID := h.createTurn(t, p, sessionID, "How does hybrid retrieval work?")

	if got := p.await(t); got != runtime.StatusDone {
		t.Fatalf("turn finished %q, want done", got)
	}

	frames := h.readStream(t, p, turnID, 0, "", 0)
	if len(frames) == 0 {
		t.Fatal("the stream produced no frames")
	}

	// seq is monotonic from 1, carried in id:, with no gaps or duplicates.
	for i, f := range frames {
		if f.ID != int64(i+1) {
			t.Fatalf("frame %d has id %d; the stream is not a gap-free sequence from 1\nframes: %s",
				i, f.ID, describe(frames))
		}
		if f.ID != f.Data.Seq {
			t.Fatalf("id %d does not match the payload seq %d", f.ID, f.Data.Seq)
		}
	}

	byType := map[string][]frame{}
	for _, f := range frames {
		byType[f.Data.Type] = append(byType[f.Data.Type], f)
	}

	// Content arrived as DELTAS, not one blob: that is what makes the stream
	// worth having.
	if len(byType[runtime.EvContent]) < 3 {
		t.Fatalf("got %d content frames; the answer was not streamed", len(byType[runtime.EvContent]))
	}
	var streamed strings.Builder
	for _, f := range byType[runtime.EvContent] {
		streamed.WriteString(f.Data.Content)
	}
	if !strings.Contains(streamed.String(), "reciprocal rank fusion") {
		t.Fatalf("streamed content = %q", streamed.String())
	}

	// The tool round is visible.
	if len(byType[runtime.EvToolCall]) != 1 || byType[runtime.EvToolCall][0].Data.Metadata["tool"] != "rag_search" {
		t.Fatalf("tool_call frames = %+v", byType[runtime.EvToolCall])
	}
	if len(byType[runtime.EvToolResult]) != 1 {
		t.Fatalf("tool_result frames = %+v", byType[runtime.EvToolResult])
	}

	// The sources event carries what a chip needs: kind, id, title, page.
	sources := byType[runtime.EvSources]
	if len(sources) != 1 {
		t.Fatalf("got %d sources events, want 1", len(sources))
	}
	list, ok := sources[0].Data.Metadata["sources"].([]any)
	if !ok || len(list) != 1 {
		t.Fatalf("sources metadata = %+v", sources[0].Data.Metadata)
	}
	src := list[0].(map[string]any)
	if src["kind"] != "chunk" || src["id"] != "chunk-1" {
		t.Fatalf("source = %+v", src)
	}
	if src["title"] != "Chapter 3" || src["page"].(float64) != 14 {
		t.Fatalf("source lost its title or page: %+v", src)
	}
	if src["document_id"] != h.docID.String() {
		t.Fatalf("source has no document to open: %+v", src)
	}

	// The result keeps the citation marker, so the UI can render the chip
	// inline where the claim was made.
	result := byType[runtime.EvResult]
	if len(result) != 1 || !strings.Contains(result[0].Data.Content, "[[cite:chunk:chunk-1]]") {
		t.Fatalf("result frame = %+v", result)
	}

	// The stream ends on `done`, and that is the LAST frame.
	last := frames[len(frames)-1]
	if last.Data.Type != runtime.EvDone || last.Event != "done" {
		t.Fatalf("last frame = %+v, want done", last)
	}

	// The transcript holds the answer, and the turn row holds provider, model
	// and usage (AC3).
	msgs := decode[map[string]any](t,
		h.do(t, p, http.MethodGet, "/v1/chat/sessions/"+sessionID+"/messages", nil), http.StatusOK)
	messages := msgs["messages"].([]any)
	if len(messages) != 2 {
		t.Fatalf("transcript has %d messages, want the question and the answer", len(messages))
	}
	answer := messages[1].(map[string]any)
	if answer["role"] != "assistant" || !strings.Contains(answer["content"].(string), "reciprocal rank fusion") {
		t.Fatalf("stored answer = %+v", answer)
	}

	turn, err := p.turns.GetTurn(context.Background(), h.userID, uuid.MustParse(turnID))
	if err != nil {
		t.Fatalf("GetTurn: %v", err)
	}
	if turn.Provider != "scripted" || turn.Model != "scripted-1" {
		t.Fatalf("turn did not record provider/model: %q/%q", turn.Provider, turn.Model)
	}
	if turn.Usage.PromptTokens != 2300 {
		t.Fatalf("turn usage = %+v, want both rounds summed", turn.Usage)
	}

	// The request the provider actually received. The API persists the question
	// before the turn starts, so the capability's history read contains it too;
	// sending both would bill the user twice for their own words and hand some
	// providers two consecutive user messages, which they reject.
	sentMessages := p.provider.sentRequests()[0].Messages
	asked := 0
	for _, m := range sentMessages {
		if m.Role == runtime.RoleUser && m.Content == "How does hybrid retrieval work?" {
			asked++
		}
	}
	if asked != 1 {
		t.Fatalf("the question reached the model %d times:\n%+v", asked, sentMessages)
	}
	for i := 1; i < len(sentMessages); i++ {
		if sentMessages[i].Role == runtime.RoleUser && sentMessages[i-1].Role == runtime.RoleUser {
			t.Fatalf("two consecutive user messages at %d:\n%+v", i, sentMessages)
		}
	}
}

// Resume with after_seq: reconnecting mid-stream must yield the rest with no
// gaps and no duplicates — Spike D's measured property, now on product code.
func TestResumeByAfterSeqHasNoGapsAndNoDuplicates(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, groundedScript())

	sessionID := h.createSession(t, p)
	turnID := h.createTurn(t, p, sessionID, "How does hybrid retrieval work?")
	if got := p.await(t); got != runtime.StatusDone {
		t.Fatalf("turn finished %q", got)
	}

	full := h.readStream(t, p, turnID, 0, "", 0)
	if len(full) < 6 {
		t.Fatalf("only %d frames; this test needs a longer stream", len(full))
	}

	// Drop after the 4th frame, then resume from it.
	leg1 := full[:4]
	cursor := leg1[len(leg1)-1].ID
	leg2 := h.readStream(t, p, turnID, cursor, "", 0)

	seen := map[int64]int{}
	for _, f := range append(append([]frame{}, leg1...), leg2...) {
		seen[f.ID]++
	}
	for seq := int64(1); seq <= full[len(full)-1].ID; seq++ {
		switch seen[seq] {
		case 1:
		case 0:
			t.Fatalf("gap: seq %d was never delivered", seq)
		default:
			t.Fatalf("duplicate: seq %d delivered %d times", seq, seen[seq])
		}
	}
	if leg2[0].ID != cursor+1 {
		t.Fatalf("resume started at %d, want %d", leg2[0].ID, cursor+1)
	}
}

// Last-Event-ID on a FRESH turn — the path that was broken in the spike until
// the live channel was filtered by the same cursor as the replay. A browser
// reconnecting on its own uses this header and no query parameter.
func TestLastEventIDResumesAFreshTurn(t *testing.T) {
	h := newHarness(t)

	// Hold the second round open so the turn is still live when the client
	// reconnects: this is the case where the replay slice is empty and only a
	// live-path filter can honour the cursor.
	script := groundedScript()
	release := make(chan struct{})
	script.hold = map[int]chan struct{}{1: release}

	p := h.start(t, script)
	sessionID := h.createSession(t, p)
	turnID := h.createTurn(t, p, sessionID, "How does hybrid retrieval work?")

	// Read the first few frames of the live turn.
	first := h.readStream(t, p, turnID, 0, "", 3)
	if len(first) != 3 {
		t.Fatalf("got %d frames from the live turn, want 3", len(first))
	}
	cursor := first[len(first)-1].ID

	// Reconnect with Last-Event-ID only, while the turn is still producing.
	resumed := make(chan []frame, 1)
	go func() { resumed <- h.readStream(t, p, turnID, 0, itoa(cursor), 0) }()

	time.Sleep(50 * time.Millisecond) // let the reconnect attach before the rest is produced
	close(release)
	if got := p.await(t); got != runtime.StatusDone {
		t.Fatalf("turn finished %q", got)
	}

	leg2 := <-resumed
	if len(leg2) == 0 {
		t.Fatal("the resumed stream delivered nothing")
	}
	if leg2[0].ID != cursor+1 {
		t.Fatalf("Last-Event-ID resume started at %d, want %d — the live path is not filtered by the cursor",
			leg2[0].ID, cursor+1)
	}
	for i := 1; i < len(leg2); i++ {
		if leg2[i].ID != leg2[i-1].ID+1 {
			t.Fatalf("gap in the resumed stream at %d -> %d", leg2[i-1].ID, leg2[i].ID)
		}
	}
	if leg2[len(leg2)-1].Data.Type != runtime.EvDone {
		t.Fatalf("the resumed stream did not reach the terminal event: %+v", leg2[len(leg2)-1])
	}
}

// A client that attaches AFTER the turn ended is told it ended, from the
// database — there is no live bus left to ask.
func TestAttachingAfterTheTurnEndedReplaysFromTheDatabase(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, groundedScript())

	sessionID := h.createSession(t, p)
	turnID := h.createTurn(t, p, sessionID, "How does hybrid retrieval work?")
	p.await(t)

	// The bus is removed when the turn goroutine returns.
	waitUntil(t, func() bool {
		_, live := p.orch.Buses().Get(uuid.MustParse(turnID))
		return !live
	})

	frames := h.readStream(t, p, turnID, 0, "", 0)
	if len(frames) == 0 {
		t.Fatal("the persisted log replayed nothing")
	}
	if frames[len(frames)-1].Data.Type != runtime.EvDone {
		t.Fatalf("the replay did not end on done: %+v", frames[len(frames)-1])
	}
	for i, f := range frames {
		if f.ID != int64(i+1) {
			t.Fatalf("persisted frame %d has seq %d; the log is not gap-free", i, f.ID)
		}
	}
}

// Kill-and-restart: a turn running in a process that goes away must reach its
// client as a terminal event, from a DIFFERENT process, within the sweep
// interval. This is the phase's success criterion.
func TestKillAndRestartDeliversTerminalEventsFromTheNewProcess(t *testing.T) {
	h := newHarness(t)

	// Process A starts a turn and blocks forever in the provider: this is a
	// turn that is genuinely mid-flight when the process dies.
	scriptA := groundedScript()
	scriptA.hold = map[int]chan struct{}{0: make(chan struct{})}
	procA := h.start(t, scriptA)

	sessionID := h.createSession(t, procA)
	turnID := h.createTurn(t, procA, sessionID, "How does hybrid retrieval work?")

	waitUntil(t, func() bool {
		turn, err := procA.turns.GetTurn(context.Background(), h.userID, uuid.MustParse(turnID))
		return err == nil && turn.Status == runtime.StatusRunning
	})

	// "Kill" process A: its in-memory bus registry and goroutine are simply
	// abandoned, and the lease stops being refreshed. Expiring the lease by
	// hand is what waiting LeaseDuration would otherwise cost the suite.
	if _, err := h.pool.Exec(context.Background(),
		`UPDATE turns SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
		uuid.MustParse(turnID)); err != nil {
		t.Fatalf("expire lease: %v", err)
	}

	// Process B has never seen this turn.
	procB := h.start(t, groundedScript())

	// Before recovery, B can still serve the stream — it just replays what is
	// persisted and ends, which is what makes the client reconnect.
	if _, live := procB.orch.Buses().Get(uuid.MustParse(turnID)); live {
		t.Fatal("the new process somehow has the old process's bus")
	}

	if n, err := procB.recovery.Sweep(context.Background()); err != nil || n == 0 {
		t.Fatalf("Sweep recovered %d turns (err %v), want at least 1", n, err)
	}

	turn, err := procB.turns.GetTurn(context.Background(), h.userID, uuid.MustParse(turnID))
	if err != nil {
		t.Fatalf("GetTurn: %v", err)
	}
	if turn.Status != runtime.StatusFailed || turn.FailureCode != runtime.FailureWorkerLost {
		t.Fatalf("recovered turn = %+v, want failed(WORKER_LOST)", turn)
	}
	if !turn.Retryable {
		t.Error("the recovered turn is not marked retryable; asking again is exactly what should work")
	}

	// And the client, reconnecting to B, is TOLD — which is the whole point:
	// a stream that merely stopped would leave the UI spinning.
	frames := h.readStream(t, procB, turnID, 0, "", 0)
	last := frames[len(frames)-1]
	if last.Data.Type != runtime.EvError {
		t.Fatalf("the reconnected client did not receive a terminal error: %+v", last)
	}
	// The wire name is the ONE rename: a frame called `error` would be
	// dispatched to EventSource's own transport-error listener.
	if last.Event != "stream_error" {
		t.Fatalf("terminal frame event name = %q, want stream_error", last.Event)
	}
	if last.Data.Metadata["failure_code"] != runtime.FailureWorkerLost {
		t.Fatalf("terminal frame metadata = %+v", last.Data.Metadata)
	}
}

// The failure mode the kill-and-restart test above could not see: the client's
// live cursor is AHEAD of the persisted log.
//
// Content deltas are coalesced for up to 500 ms, so at crash time the persisted
// log lags what clients already received. The sweeper numbers its WORKER_LOST
// event from the persisted log, so that event can land at or below the cursor
// the client reconnects with — `EventsAfter(cursor)` then returns nothing and
// the stream ends empty, which an EventSource answers by retrying forever.
func TestAReconnectAheadOfThePersistedLogStillGetsATerminalFrame(t *testing.T) {
	h := newHarness(t)

	scriptA := groundedScript()
	scriptA.hold = map[int]chan struct{}{0: make(chan struct{})}
	procA := h.start(t, scriptA)

	sessionID := h.createSession(t, procA)
	turnID := h.createTurn(t, procA, sessionID, "How does hybrid retrieval work?")
	id := uuid.MustParse(turnID)

	waitUntil(t, func() bool {
		turn, err := procA.turns.GetTurn(context.Background(), h.userID, id)
		return err == nil && turn.Status == runtime.StatusRunning
	})

	// Kill process A and sweep from a new one.
	if _, err := h.pool.Exec(context.Background(),
		`UPDATE turns SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, id); err != nil {
		t.Fatalf("expire lease: %v", err)
	}
	procB := h.start(t, groundedScript())
	if n, err := procB.recovery.Sweep(context.Background()); err != nil || n == 0 {
		t.Fatalf("Sweep recovered %d turns (err %v)", n, err)
	}

	// Whatever the persisted log holds, a client resuming from well beyond it
	// must still be told the turn is over.
	persisted, err := procB.turns.EventsAfter(context.Background(), h.userID, id, 0, 5000)
	if err != nil {
		t.Fatalf("EventsAfter: %v", err)
	}
	var maxSeq int64
	for _, ev := range persisted {
		if ev.Seq > maxSeq {
			maxSeq = ev.Seq
		}
	}

	cursor := maxSeq + 50 // a client that saw far more than was ever flushed
	frames := h.readStream(t, procB, turnID, 0, itoa(cursor), 0)

	if len(frames) == 0 {
		t.Fatal("a client resuming ahead of the persisted log received nothing; it would retry forever")
	}
	last := frames[len(frames)-1]
	if last.Data.Type != runtime.EvError || last.Event != "stream_error" {
		t.Fatalf("last frame = %+v, want a terminal stream_error", last)
	}
	if last.ID <= cursor {
		t.Fatalf("terminal frame id %d is at or below the client's cursor %d — it would be filtered as already seen",
			last.ID, cursor)
	}
	if last.Data.Metadata["failure_code"] != runtime.FailureWorkerLost {
		t.Fatalf("terminal frame metadata = %+v", last.Data.Metadata)
	}
}

// A turn that finished normally must also close a late reconnect's stream, even
// when the client's cursor is past everything on disk.
func TestAReconnectAfterASuccessfulTurnIsTold(t *testing.T) {
	h := newHarness(t)
	p := h.start(t, groundedScript())

	sessionID := h.createSession(t, p)
	turnID := h.createTurn(t, p, sessionID, "How does hybrid retrieval work?")
	p.await(t)
	waitUntil(t, func() bool {
		_, live := p.orch.Buses().Get(uuid.MustParse(turnID))
		return !live
	})

	frames := h.readStream(t, p, turnID, 0, itoa(9999), 0)
	if len(frames) != 1 {
		t.Fatalf("got %d frames, want just the synthesized terminal: %+v", len(frames), frames)
	}
	if frames[0].Data.Type != runtime.EvDone {
		t.Fatalf("terminal frame = %+v, want done", frames[0])
	}
	if frames[0].ID <= 9999 {
		t.Fatalf("terminal frame id %d is not above the cursor", frames[0].ID)
	}
}

// describe renders a stream as "id:type" pairs, so a gap failure says WHICH
// events are missing rather than only that one is.
func describe(frames []frame) string {
	parts := make([]string, 0, len(frames))
	for _, f := range frames {
		parts = append(parts, itoa(f.ID)+":"+f.Data.Type)
	}
	return strings.Join(parts, " ")
}

func waitUntil(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("condition never became true within 10s")
}
