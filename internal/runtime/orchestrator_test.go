package runtime

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/citations"
)

// harness wires an orchestrator over in-memory stores and returns the pieces a
// test asserts on.
type harness struct {
	orch     *Orchestrator
	turns    *fakeTurnStore
	events   *fakeEventStore
	tools    *ToolRegistry
	buses    *BusRegistry
	session  Session
	finished chan string
}

func newHarness(t *testing.T, capability Capability, tools ...Tool) *harness {
	t.Helper()

	turns := newFakeTurnStore()
	events := newFakeEventStore()
	registry := NewToolRegistry()
	registry.Register(tools...)

	caps := NewCapabilityRegistry()
	caps.Register(capability)

	buses := NewBusRegistry()
	finished := make(chan string, 4)

	orch := NewOrchestrator(OrchestratorDeps{
		Turns: turns, Events: events, Capabilities: caps, Tools: registry,
		Providers: fakeResolver{provider: &fakeProvider{name: "fake", model: "fake-1"}},
		Buses:     buses,
		OnFinish:  func(_ uuid.UUID, status string) { finished <- status },
	})

	return &harness{
		orch: orch, turns: turns, events: events, tools: registry, buses: buses,
		session:  Session{ID: uuid.New(), UserID: uuid.New(), KBIDs: []uuid.UUID{uuid.New()}},
		finished: finished,
	}
}

func (h *harness) await(t *testing.T) string {
	t.Helper()
	select {
	case status := <-h.finished:
		return status
	case <-time.After(5 * time.Second):
		t.Fatal("turn never reached a terminal status")
		return ""
	}
}

// A turn that completes: queued → running → done, with the terminal `done`
// event persisted and the provider recorded on the row (AC3).
func TestTurnRunsToDone(t *testing.T) {
	h := newHarness(t, fakeCapability{name: "chat", run: func(_ context.Context, tc *TurnContext) error {
		tc.RecordProvider("fake", "fake-1")
		tc.AddUsage(&Usage{PromptTokens: 100, CompletionTokens: 20})
		tc.EmitContent("answering", "hello")
		tc.Emit(Event{Type: EvResult, Content: "hello"})
		return nil
	}})

	turn, err := h.orch.Run(context.Background(), StartTurn{Session: h.session, Capability: "chat"})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if turn.Status != StatusQueued {
		t.Fatalf("a fresh turn is %q, want queued", turn.Status)
	}
	if got := h.await(t); got != StatusDone {
		t.Fatalf("turn finished %q, want done", got)
	}

	final, err := h.turns.GetTurn(context.Background(), h.session.UserID, turn.ID)
	if err != nil {
		t.Fatalf("GetTurn: %v", err)
	}
	if final.Status != StatusDone || final.FinishedAt == nil {
		t.Fatalf("final row = %+v", final)
	}
	if final.Provider != "fake" || final.Model != "fake-1" {
		t.Errorf("turn did not record provider/model: %q/%q", final.Provider, final.Model)
	}
	if final.Usage.PromptTokens != 100 {
		t.Errorf("turn did not record usage: %+v", final.Usage)
	}
	if final.LeaseExpires != nil {
		t.Error("a finished turn still holds a lease; the sweeper would fail it")
	}

	waitFor(t, func() bool { return hasType(h.events.all(), EvDone) })
}

// A capability error becomes a failed turn with a classified code and a
// terminal `error` event — the client learns why without polling the row.
func TestTurnFailureIsClassifiedAndStreamed(t *testing.T) {
	h := newHarness(t, fakeCapability{name: "chat", run: func(context.Context, *TurnContext) error {
		return ErrNoProvider
	}})

	turn, err := h.orch.Run(context.Background(), StartTurn{Session: h.session, Capability: "chat"})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := h.await(t); got != StatusFailed {
		t.Fatalf("turn finished %q, want failed", got)
	}

	final, _ := h.turns.GetTurn(context.Background(), h.session.UserID, turn.ID)
	if final.FailureCode != FailureNoProvider {
		t.Errorf("failure_code = %q, want %q", final.FailureCode, FailureNoProvider)
	}
	if final.Retryable {
		t.Error("NO_PROVIDER marked retryable; a retry button here spends money to fail identically")
	}
	waitFor(t, func() bool { return hasType(h.events.all(), EvError) })
}

func TestFailureClassification(t *testing.T) {
	for _, tc := range []struct {
		err       error
		code      string
		retryable bool
	}{
		{ErrNoProvider, FailureNoProvider, false},
		{ErrToolRoundLimit, FailureToolRounds, false},
		{ErrTokenBudget, FailureTokenBudget, false},
		{ErrProvider, FailureProvider, true},
		{context.DeadlineExceeded, FailureProvider, true},
		{errors.New("something else"), FailureCapability, false},
	} {
		code, retryable := classify(tc.err)
		if code != tc.code || retryable != tc.retryable {
			t.Errorf("classify(%v) = (%s, %v), want (%s, %v)", tc.err, code, retryable, tc.code, tc.retryable)
		}
	}
}

// ask_user: the row moves to waiting_user, a wait_for_input event is emitted,
// and the answer resumes the turn.
func TestAskUserParksTheTurnAndResumesOnAnswer(t *testing.T) {
	asked := make(chan struct{})
	var answer string

	h := newHarness(t, fakeCapability{name: "chat", run: func(ctx context.Context, tc *TurnContext) error {
		go func() { close(asked) }()
		a, err := tc.Ask(ctx, AskUser{Question: "Which chapter?", Options: []string{"3", "4"}})
		if err != nil {
			return err
		}
		answer = a
		return nil
	}})

	turn, err := h.orch.Run(context.Background(), StartTurn{Session: h.session, Capability: "chat"})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	<-asked

	waitFor(t, func() bool {
		cur, err := h.turns.GetTurn(context.Background(), h.session.UserID, turn.ID)
		return err == nil && cur.Status == StatusWaitingUser
	})

	bus, ok := h.buses.Get(turn.ID)
	if !ok {
		t.Fatal("a parked turn is not in the bus registry; the answer could not be routed")
	}
	replay, _, cancel := bus.Subscribe(0)
	cancel()
	if !hasType(replay, EvWaitForInput) {
		t.Fatalf("no wait_for_input event was emitted: %+v", replay)
	}

	if !h.buses.Answer(turn.ID, Answer{Text: "chapter 4"}) {
		t.Fatal("the answer was refused")
	}
	if got := h.await(t); got != StatusDone {
		t.Fatalf("after answering, turn finished %q, want done", got)
	}
	if answer != "chapter 4" {
		t.Fatalf("capability received %q", answer)
	}
}

// An answer addressed to a question that has already closed must not be
// consumed by the NEXT one. Without the question id the server cannot tell the
// two apart: a retried POST arriving while a later question is open looks
// exactly like that question's answer.
func TestAnAnswerForAnEarlierQuestionIsDiscarded(t *testing.T) {
	var first, second string
	asked := make(chan map[string]any, 4)

	h := newHarness(t, fakeCapability{name: "chat", run: func(ctx context.Context, tc *TurnContext) error {
		a, err := tc.Ask(ctx, AskUser{Question: "first"})
		if err != nil {
			return err
		}
		first = a
		b, err := tc.Ask(ctx, AskUser{Question: "second"})
		if err != nil {
			return err
		}
		second = b
		return nil
	}})

	turn, err := h.orch.Run(context.Background(), StartTurn{Session: h.session, Capability: "chat"})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	// Watch the stream for the question ids the turn hands out.
	waitFor(t, func() bool { _, ok := h.buses.Get(turn.ID); return ok })
	bus, _ := h.buses.Get(turn.ID)
	go func() {
		// The replay matters: the first question can be emitted before this
		// goroutine subscribes, and then it is only in the backlog.
		replay, live, cancel := bus.Subscribe(0)
		defer cancel()
		for _, ev := range replay {
			if ev.Type == EvWaitForInput {
				asked <- ev.Metadata
			}
		}
		for ev := range live {
			if ev.Type == EvWaitForInput {
				asked <- ev.Metadata
			}
		}
	}()

	firstMeta := <-asked
	firstID, _ := firstMeta["question_id"].(string)
	if firstID == "" {
		t.Fatal("wait_for_input carried no question_id")
	}
	if !h.buses.Answer(turn.ID, Answer{QuestionID: firstID, Text: "answer one"}) {
		t.Fatal("first answer refused")
	}

	secondMeta := <-asked
	secondID, _ := secondMeta["question_id"].(string)
	if secondID == firstID {
		t.Fatal("both questions were given the same id")
	}

	// A retry of the FIRST answer, arriving while the second question is open.
	waitFor(t, func() bool { return h.buses.Answer(turn.ID, Answer{QuestionID: firstID, Text: "answer one"}) })
	// Then the real answer to the second.
	waitFor(t, func() bool { return h.buses.Answer(turn.ID, Answer{QuestionID: secondID, Text: "answer two"}) })

	if got := h.await(t); got != StatusDone {
		t.Fatalf("turn finished %q", got)
	}
	if first != "answer one" {
		t.Fatalf("first question received %q", first)
	}
	if second != "answer two" {
		t.Fatalf("second question received %q - a stale answer was accepted", second)
	}
}

// An answer with NO question id is trusted, because there is nothing else to go
// on. A client that cannot echo the id still works.
func TestAnAnswerWithoutAQuestionIDIsAccepted(t *testing.T) {
	var answer string
	h := newHarness(t, fakeCapability{name: "chat", run: func(ctx context.Context, tc *TurnContext) error {
		a, err := tc.Ask(ctx, AskUser{Question: "which?"})
		if err != nil {
			return err
		}
		answer = a
		return nil
	}})

	turn, err := h.orch.Run(context.Background(), StartTurn{Session: h.session, Capability: "chat"})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	waitFor(t, func() bool {
		cur, err := h.turns.GetTurn(context.Background(), h.session.UserID, turn.ID)
		return err == nil && cur.Status == StatusWaitingUser
	})

	if !h.buses.Answer(turn.ID, Answer{Text: "no id"}) {
		t.Fatal("an answer without a question id was refused")
	}
	if got := h.await(t); got != StatusDone {
		t.Fatalf("turn finished %q", got)
	}
	if answer != "no id" {
		t.Fatalf("capability received %q", answer)
	}
}

// A question nobody answers must not pin the turn open. The lease is refreshed
// for as long as the turn lives, so the sweeper never sees a parked turn — the
// deadline has to come from the turn itself.
func TestAnUnansweredQuestionEndsTheTurn(t *testing.T) {
	h := newHarness(t, fakeCapability{name: "chat", run: func(ctx context.Context, tc *TurnContext) error {
		tc.AskWait = 20 * time.Millisecond
		_, err := tc.Ask(ctx, AskUser{Question: "nobody is listening"})
		return err
	}})

	turn, err := h.orch.Run(context.Background(), StartTurn{Session: h.session, Capability: "chat"})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	if got := h.await(t); got != StatusFailed {
		t.Fatalf("an unanswered turn finished %q, want failed", got)
	}
	final, err := h.turns.GetTurn(context.Background(), h.session.UserID, turn.ID)
	if err != nil {
		t.Fatalf("GetTurn: %v", err)
	}
	if final.Status != StatusFailed {
		t.Fatalf("final status = %q", final.Status)
	}
	if final.LeaseExpires != nil {
		t.Error("an abandoned turn kept its lease")
	}
	if _, live := h.buses.Get(turn.ID); live {
		t.Error("the bus outlived the turn")
	}
}

// A cancel mid-turn ends it as cancelled, not failed. The distinction matters:
// the UI must not tell a user who pressed stop that something crashed.
func TestCancelEndsTheTurnAsCancelled(t *testing.T) {
	running := make(chan struct{})
	h := newHarness(t, fakeCapability{name: "chat", run: func(ctx context.Context, tc *TurnContext) error {
		close(running)
		<-ctx.Done()
		return ErrTurnCancelled
	}})

	turn, err := h.orch.Run(context.Background(), StartTurn{Session: h.session, Capability: "chat"})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	<-running

	if !h.buses.Cancel(turn.ID) {
		t.Fatal("the running turn was not found in the registry")
	}
	if got := h.await(t); got != StatusCancelled {
		t.Fatalf("turn finished %q, want cancelled", got)
	}
}

// The turn must outlive the HTTP request that started it: the POST returns
// immediately and the client then opens the stream.
func TestTurnOutlivesTheRequestContext(t *testing.T) {
	proceed := make(chan struct{})
	h := newHarness(t, fakeCapability{name: "chat", run: func(ctx context.Context, tc *TurnContext) error {
		<-proceed
		if err := ctx.Err(); err != nil {
			return err
		}
		tc.Emit(Event{Type: EvResult, Content: "finished anyway"})
		return nil
	}})

	reqCtx, cancelRequest := context.WithCancel(context.Background())
	if _, err := h.orch.Run(reqCtx, StartTurn{Session: h.session, Capability: "chat"}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	cancelRequest() // the POST returned
	close(proceed)

	if got := h.await(t); got != StatusDone {
		t.Fatalf("turn finished %q after its request context was cancelled, want done", got)
	}
}

// Network tools are not mounted once untrusted document text is in context,
// unless the session says otherwise. Red-team Security 4.
func TestNetworkToolsAreGatedByRetrievedContextAndConsent(t *testing.T) {
	registry := NewToolRegistry()
	registry.Register(
		fakeTool{name: "rag_search"},
		fakeTool{name: "web_fetch", network: true},
	)

	for _, tc := range []struct {
		name        string
		allowWeb    bool
		hasDocs     bool
		wantMounted bool
	}{
		{"no documents, no consent: mounted", false, false, true},
		{"documents, no consent: WITHHELD", false, true, false},
		{"documents, explicit consent: mounted", true, true, true},
		{"no documents, consent: mounted", true, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var sawWeb bool
			for _, tool := range registry.Mounted(tc.allowWeb, tc.hasDocs) {
				if tool.Name() == "web_fetch" {
					sawWeb = true
				}
			}
			if sawWeb != tc.wantMounted {
				t.Fatalf("web_fetch mounted = %v, want %v", sawWeb, tc.wantMounted)
			}
			// The local tool is never withheld.
			if len(registry.Definitions(tc.allowWeb, tc.hasDocs)) == 0 {
				t.Fatal("rag_search was withheld too")
			}
		})
	}
}

func TestToolRegistryRefusesDuplicateNames(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("registering two tools under one name was allowed; the model's call would be resolved by map order")
		}
	}()
	r := NewToolRegistry()
	r.Register(fakeTool{name: "same"}, fakeTool{name: "same"})
}

func TestUnknownToolIsAnError(t *testing.T) {
	r := NewToolRegistry()
	if _, err := r.Get("nope"); !errors.Is(err, ErrToolNotFound) {
		t.Fatalf("Get(unknown) = %v, want ErrToolNotFound", err)
	}
}

// The token budget is a hard stop, checked before every round.
func TestBudgetExceededIsDetected(t *testing.T) {
	tc := &TurnContext{TokenBudget: 100}
	if tc.BudgetExceeded() {
		t.Fatal("a fresh turn is already over budget")
	}
	tc.AddUsage(&Usage{PromptTokens: 60, CompletionTokens: 50})
	if !tc.BudgetExceeded() {
		t.Fatal("110 tokens against a 100 budget was not detected")
	}
}

func TestSourcesAccumulateAcrossToolCalls(t *testing.T) {
	tc := &TurnContext{}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			tc.AddSources(citations.Source{Kind: citations.KindChunk, ID: string(rune('a' + i))})
		}(i)
	}
	wg.Wait()
	if len(tc.Sources()) != 8 {
		t.Fatalf("collected %d sources, want 8", len(tc.Sources()))
	}
}

func hasType(events []Event, typ string) bool {
	for _, ev := range events {
		if ev.Type == typ {
			return true
		}
	}
	return false
}

// MaxToolRounds and the budget are the two things standing between a
// misbehaving model and a user's own API bill. Pin them.
func TestLoopLimitsAreConservative(t *testing.T) {
	if MaxToolRounds > 12 {
		t.Fatalf("MaxToolRounds = %d; a runaway loop costs the USER money", MaxToolRounds)
	}
	if DefaultTokenBudget <= 0 {
		t.Fatal("there is no default token budget")
	}
}

// A capability named in CapabilityTools sees that registry and nothing else;
// every other capability keeps the shared one. This is how the web tools exist
// for research and do not exist for chat — whatever the session's toggle says.
// Params and Images reach the capability unchanged.
func TestCapabilityToolsScopeARegistryToOneCapability(t *testing.T) {
	shared := NewToolRegistry()
	shared.Register(fakeTool{name: "rag_search"})
	research := NewToolRegistry()
	research.Register(fakeTool{name: "rag_search"}, fakeTool{name: "web_search", network: true})

	seen := make(chan []string, 2)
	params := make(chan string, 1)
	images := make(chan int, 1)
	run := func(_ context.Context, tc *TurnContext) error {
		seen <- tc.Tools.Names()
		if tc.Turn.Capability == "research" {
			params <- tc.Param("mode")
			images <- len(tc.Images)
		}
		return nil
	}
	caps := NewCapabilityRegistry()
	caps.Register(fakeCapability{name: "chat", run: run}, fakeCapability{name: "research", run: run})

	finished := make(chan string, 2)
	orch := NewOrchestrator(OrchestratorDeps{
		Turns: newFakeTurnStore(), Events: newFakeEventStore(), Capabilities: caps,
		Tools: shared, CapabilityTools: map[string]*ToolRegistry{"research": research},
		Providers: fakeResolver{provider: &fakeProvider{name: "fake", model: "fake-1"}},
		OnFinish:  func(_ uuid.UUID, status string) { finished <- status },
	})
	session := Session{ID: uuid.New(), UserID: uuid.New(), AllowWeb: true}

	for _, name := range []string{"chat", "research"} {
		if _, err := orch.Run(context.Background(), StartTurn{
			Session: session, Capability: name,
			Params: map[string]string{"mode": "deep"},
			Images: []Image{{MimeType: "image/png", Data: "AA=="}},
		}); err != nil {
			t.Fatalf("Run %s: %v", name, err)
		}
		if got := <-seen; name == "chat" && strings.Join(got, ",") != "rag_search" {
			t.Fatalf("chat mounted %v; a chat turn must never have a web tool, even with allow_web on", got)
		} else if name == "research" && strings.Join(got, ",") != "rag_search,web_search" {
			t.Fatalf("research mounted %v", got)
		}
		<-finished
	}
	if got := <-params; got != "deep" {
		t.Errorf("Param(mode) = %q", got)
	}
	if got := <-images; got != 1 {
		t.Errorf("images = %d", got)
	}
}

// CallTool is the gate for pipeline-driven calls. Before any document text a
// network tool runs; after a tool returns document text it is refused unless
// the session allows the web; an ordinary tool is unaffected.
func TestCallToolAppliesTheEgressGate(t *testing.T) {
	var webCalls int
	registry := NewToolRegistry()
	registry.Register(
		fakeTool{name: "rag_search", run: func(context.Context, map[string]any, ToolInput) (ToolResult, error) {
			return ToolResult{Content: "<document>…</document>", Retrieved: true,
				Sources: []citations.Source{{Kind: citations.KindChunk, ID: "c1"}}}, nil
		}},
		fakeTool{name: "web_search", network: true, run: func(_ context.Context, _ map[string]any, in ToolInput) (ToolResult, error) {
			webCalls++
			return ToolResult{Content: "web"}, nil
		}},
	)

	for _, allowWeb := range []bool{false, true} {
		webCalls = 0
		tc := &TurnContext{
			Turn:    Turn{ID: uuid.New(), UserID: uuid.New(), Capability: "research"},
			Session: Session{ID: uuid.New(), AllowWeb: allowWeb},
			Bus:     NewStreamBus(uuid.New(), uuid.New()),
			Tools:   registry,
		}
		ctx := context.Background()

		if _, err := tc.CallTool(ctx, "gather", "web_search", nil, nil); err != nil {
			t.Fatalf("before any document text: %v", err)
		}
		if _, err := tc.CallTool(ctx, "gather", "rag_search", nil, nil); err != nil {
			t.Fatalf("rag_search: %v", err)
		}
		if len(tc.Sources()) != 1 || !tc.Retrieved() {
			t.Fatal("rag_search's sources/retrieved flag were not recorded")
		}
		_, err := tc.CallTool(ctx, "gather", "web_search", nil, nil)
		switch {
		case !allowWeb && !errors.Is(err, ErrToolGated):
			t.Fatalf("web off, after document text: err = %v, want ErrToolGated", err)
		case !allowWeb && (webCalls != 1 || tc.ToolAvailable("web_search")):
			t.Fatalf("the gated tool ran or reports itself available (calls %d)", webCalls)
		case allowWeb && (err != nil || webCalls != 2):
			t.Fatalf("web allowed: err = %v calls = %d", err, webCalls)
		}
	}
}

// A capability that panics fails its own turn; the process, and every other
// turn in it, carries on (security audit F-1).
func TestAPanickingCapabilityFailsOnlyItsTurn(t *testing.T) {
	h := newHarness(t, fakeCapability{name: "chat", run: func(context.Context, *TurnContext) error {
		panic("nil map in a parser")
	}})
	if _, err := h.orch.Run(context.Background(), StartTurn{Session: h.session, Capability: "chat"}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := h.await(t); got != StatusFailed {
		t.Fatalf("turn finished %q, want failed", got)
	}
}
