package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/runtime"
)

// Tests for what the loop took from postclaw's agent (plan 261019-1015).

// scriptProvider answers each call with a function of the request, so a test
// can react to what was sent (a summary call, a final call without tools).
type scriptProvider struct {
	mu       sync.Mutex
	requests []runtime.ChatRequest
	reply    func(n int, req runtime.ChatRequest, onChunk func(runtime.StreamChunk)) (*runtime.ChatResponse, error)
}

func (p *scriptProvider) Name() string         { return "script" }
func (p *scriptProvider) DefaultModel() string { return "script-1" }

func (p *scriptProvider) Chat(ctx context.Context, req runtime.ChatRequest) (*runtime.ChatResponse, error) {
	return p.ChatStream(ctx, req, func(runtime.StreamChunk) {})
}

func (p *scriptProvider) ChatStream(
	_ context.Context, req runtime.ChatRequest, onChunk func(runtime.StreamChunk),
) (*runtime.ChatResponse, error) {
	p.mu.Lock()
	n := len(p.requests)
	p.requests = append(p.requests, req)
	p.mu.Unlock()
	return p.reply(n, req, onChunk)
}

func (p *scriptProvider) sent() []runtime.ChatRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]runtime.ChatRequest(nil), p.requests...)
}

func answer(text string) *runtime.ChatResponse {
	return &runtime.ChatResponse{Content: text, FinishReason: "stop"}
}

func toolCall(id, name string, args map[string]any) runtime.ToolCall {
	raw, _ := json.Marshal(args)
	return runtime.ToolCall{ID: id, Name: name, Arguments: args, RawArguments: string(raw)}
}

// summaryStore is memoryMessages plus the SummaryWriter the pg store has.
type summaryStore struct {
	memoryMessages
	summary string
	through uuid.UUID
}

func (s *summaryStore) SetSummary(_ context.Context, _, _ uuid.UUID, summary string, through uuid.UUID) error {
	s.summary, s.through = summary, through
	return nil
}

func storedAttachments(t *testing.T, m runtime.ChatMessage) map[string]json.RawMessage {
	t.Helper()
	var out map[string]json.RawMessage
	if err := json.Unmarshal(m.Attachments, &out); err != nil {
		t.Fatalf("attachments: %v", err)
	}
	return out
}

// Running out of rounds is not the end: one call without tools asks for an
// answer from what was found, and that answer is delivered.
func TestTheLastRoundAsksForAnAnswerInsteadOfFailing(t *testing.T) {
	tool := &scriptedTool{name: "rag_search", result: runtime.ToolResult{Content: "a passage"}}
	provider := &scriptProvider{reply: func(n int, req runtime.ChatRequest, _ func(runtime.StreamChunk)) (*runtime.ChatResponse, error) {
		if len(req.Tools) == 0 {
			return answer("What I found."), nil
		}
		// A new query every round, so the repeat guard never steps in.
		return &runtime.ChatResponse{FinishReason: "tool_calls", ToolCalls: []runtime.ToolCall{
			toolCall(fmt.Sprint("c", n), "rag_search", map[string]any{"query": fmt.Sprint("q", n)}),
		}}, nil
	}}

	capability, tc, _, msgs := build(t, provider, tool)
	if err := capability.Run(context.Background(), tc); err != nil {
		t.Fatalf("Run = %v, want an answer", err)
	}
	if tool.callCount() != runtime.MaxToolRounds {
		t.Fatalf("the tool ran %d times", tool.callCount())
	}
	last := provider.sent()[len(provider.sent())-1]
	if !strings.Contains(last.Messages[len(last.Messages)-1].Content, "every tool round") {
		t.Fatal("the final call did not say the rounds were used up")
	}
	stored, _ := msgs.last()
	if stored.Content != "What I found." {
		t.Fatalf("stored %q", stored.Content)
	}
	var work workRecord
	_ = json.Unmarshal(storedAttachments(t, stored)["work"], &work)
	if !work.LimitReached || len(work.Steps) != runtime.MaxToolRounds {
		t.Fatalf("work = %+v", work)
	}
}

// Several calls in one response run at the same time, and their results go
// back to the model in the order it asked.
func TestCallsInOneResponseRunConcurrentlyAndReturnInOrder(t *testing.T) {
	var running, peak atomic.Int32
	tool := &funcTool{name: "rag_search", fn: func(args map[string]any) runtime.ToolResult {
		now := running.Add(1)
		for {
			p := peak.Load()
			if now <= p || peak.CompareAndSwap(p, now) {
				break
			}
		}
		time.Sleep(30 * time.Millisecond)
		running.Add(-1)
		return runtime.ToolResult{Content: "result for " + args["query"].(string)}
	}}
	provider := &scriptProvider{reply: func(n int, _ runtime.ChatRequest, _ func(runtime.StreamChunk)) (*runtime.ChatResponse, error) {
		if n > 0 {
			return answer("done"), nil
		}
		return &runtime.ChatResponse{FinishReason: "tool_calls", ToolCalls: []runtime.ToolCall{
			toolCall("a", "rag_search", map[string]any{"query": "one"}),
			toolCall("b", "rag_search", map[string]any{"query": "two"}),
			toolCall("c", "rag_search", map[string]any{"query": "three"}),
		}}, nil
	}}

	capability, tc, _, _ := build(t, provider, tool)
	if err := capability.Run(context.Background(), tc); err != nil {
		t.Fatal(err)
	}
	if peak.Load() < 2 {
		t.Fatalf("at most %d calls ran at once; they ran one by one", peak.Load())
	}
	second := provider.sent()[1].Messages
	var got []string
	for _, m := range second {
		if m.Role == runtime.RoleTool {
			got = append(got, m.ToolCallID+"="+m.Content)
		}
	}
	want := []string{"a=result for one", "b=result for two", "c=result for three"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("tool results = %v, want %v", got, want)
	}
}

// A model that asks for the same thing twice gets the first result back
// instead of a second paid call.
func TestTheSameCallIsNotRunTwiceInATurn(t *testing.T) {
	tool := &scriptedTool{name: "rag_search", result: runtime.ToolResult{Content: "x"}}
	provider := &scriptProvider{reply: func(n int, _ runtime.ChatRequest, _ func(runtime.StreamChunk)) (*runtime.ChatResponse, error) {
		if n == 2 {
			return answer("ok"), nil
		}
		// Same arguments, keys in another order.
		args := map[string]any{"query": "cells", "top_k": 5.0}
		if n == 1 {
			args = map[string]any{"top_k": 5.0, "query": "cells"}
		}
		return &runtime.ChatResponse{FinishReason: "tool_calls",
			ToolCalls: []runtime.ToolCall{toolCall(fmt.Sprint(n), "rag_search", args)}}, nil
	}}

	capability, tc, bus, _ := build(t, provider, tool)
	if err := capability.Run(context.Background(), tc); err != nil {
		t.Fatal(err)
	}
	if tool.callCount() != 1 {
		t.Fatalf("ran %d times", tool.callCount())
	}
	third := provider.sent()[2].Messages
	if !strings.Contains(third[len(third)-1].Content, "already made this exact call") {
		t.Fatalf("the model was not told: %q", third[len(third)-1].Content)
	}
	repeated := false
	for _, ev := range events(bus) {
		if ev.Type == runtime.EvToolResult && ev.Metadata["repeated"] == true {
			repeated = true
		}
	}
	if !repeated {
		t.Fatal("no tool_result marked the repeat")
	}
}

// A refusal because the prompt is too long shrinks it and tries once more.
func TestAContextOverflowShrinksThePromptAndRetriesOnce(t *testing.T) {
	provider := &scriptProvider{reply: func(n int, req runtime.ChatRequest, _ func(runtime.StreamChunk)) (*runtime.ChatResponse, error) {
		if n == 0 {
			return nil, errors.New("400: This model's maximum context length is 8192 tokens")
		}
		return answer("fits now"), nil
	}}
	capability, tc, _, store := build(t, provider)
	for i := range 60 {
		store.history = append(store.history, runtime.ChatMessage{
			ID: uuid.New(), Role: []string{runtime.RoleUser, runtime.RoleAssistant}[i%2],
			Content: strings.Repeat("word ", 300),
		})
	}

	if err := capability.Run(context.Background(), tc); err != nil {
		t.Fatalf("Run = %v", err)
	}
	sent := provider.sent()
	if len(sent) != 2 {
		t.Fatalf("%d calls, want 2", len(sent))
	}
	if len(sent[1].Messages) >= len(sent[0].Messages) {
		t.Fatalf("the retry sent %d messages, the first %d", len(sent[1].Messages), len(sent[0].Messages))
	}
}

// A second overflow is a failure, not a loop.
func TestASecondOverflowFailsTheTurn(t *testing.T) {
	provider := &scriptProvider{reply: func(int, runtime.ChatRequest, func(runtime.StreamChunk)) (*runtime.ChatResponse, error) {
		return nil, errors.New("context_length_exceeded")
	}}
	capability, tc, _, _ := build(t, provider)
	err := capability.Run(context.Background(), tc)
	if !errors.Is(err, runtime.ErrProvider) {
		t.Fatalf("Run = %v", err)
	}
	if len(provider.sent()) != 2 {
		t.Fatalf("%d calls", len(provider.sent()))
	}
}

// An answer cut at the output limit is continued once and joined.
func TestAnAnswerCutAtTheLimitIsContinued(t *testing.T) {
	provider := &scriptProvider{reply: func(n int, _ runtime.ChatRequest, _ func(runtime.StreamChunk)) (*runtime.ChatResponse, error) {
		if n == 0 {
			return &runtime.ChatResponse{Content: "The first half, ", FinishReason: "length"}, nil
		}
		return &runtime.ChatResponse{Content: "and the rest.", FinishReason: "length"}, nil
	}}
	capability, tc, _, store := build(t, provider)
	if err := capability.Run(context.Background(), tc); err != nil {
		t.Fatal(err)
	}
	if len(provider.sent()) != 2 {
		t.Fatalf("%d calls, want exactly one continuation", len(provider.sent()))
	}
	stored, _ := store.last()
	if stored.Content != "The first half, and the rest." {
		t.Fatalf("stored %q", stored.Content)
	}
}

// Text that already streamed survives a provider failure, marked incomplete,
// and the turn still fails.
func TestStreamedTextIsKeptWhenTheProviderFails(t *testing.T) {
	provider := &scriptProvider{reply: func(_ int, _ runtime.ChatRequest, onChunk func(runtime.StreamChunk)) (*runtime.ChatResponse, error) {
		onChunk(runtime.StreamChunk{Content: "Mitochondria make ATP"})
		return nil, errors.New("connection reset")
	}}
	capability, tc, _, store := build(t, provider)
	err := capability.Run(context.Background(), tc)
	if !errors.Is(err, runtime.ErrProvider) {
		t.Fatalf("Run = %v", err)
	}
	stored, ok := store.last()
	if !ok || stored.Content != "Mitochondria make ATP" {
		t.Fatalf("stored %+v", stored)
	}
	if string(storedAttachments(t, stored)["incomplete"]) != "true" {
		t.Fatal("the partial answer is not marked incomplete")
	}
}

// What no longer fits is summarised once, stored, and sent in its place; the
// newest messages are sent as they are.
func TestEarlierMessagesBeyondTheBudgetAreSummarised(t *testing.T) {
	provider := &scriptProvider{reply: func(_ int, req runtime.ChatRequest, _ func(runtime.StreamChunk)) (*runtime.ChatResponse, error) {
		if strings.Contains(req.Messages[0].Content, "running summary") {
			return answer("They studied cell membranes."), nil
		}
		return answer("ok"), nil
	}}
	store := &summaryStore{}
	capability := New(store)
	_, tc, bus, _ := build(t, provider)
	for i := range 80 {
		store.history = append(store.history, runtime.ChatMessage{
			ID: uuid.New(), Role: []string{runtime.RoleUser, runtime.RoleAssistant}[i%2],
			Content: fmt.Sprintf("message %d %s", i, strings.Repeat("long text ", 200)),
		})
	}

	if err := capability.Run(context.Background(), tc); err != nil {
		t.Fatal(err)
	}
	if store.summary != "They studied cell membranes." || store.through == uuid.Nil {
		t.Fatalf("summary = %q through %v", store.summary, store.through)
	}
	main := provider.sent()[1]
	if promptTokens(main.Messages) > historyBudget(defaultContextWindow)+2000 {
		t.Fatalf("the prompt is %d tokens", promptTokens(main.Messages))
	}
	foundNote, foundNewest := false, false
	for _, m := range main.Messages {
		foundNote = foundNote || strings.Contains(m.Content, "They studied cell membranes.")
		foundNewest = foundNewest || strings.HasPrefix(m.Content, "message 79 ")
	}
	if !foundNote || !foundNewest {
		t.Fatalf("summary sent %v, newest message sent %v", foundNote, foundNewest)
	}
	compacted := false
	for _, ev := range events(bus) {
		if ev.Type == runtime.EvProgress && ev.Metadata["kind"] == "compaction" {
			compacted = true
		}
	}
	if !compacted {
		t.Fatal("no compaction progress event")
	}
}

// Messages already covered by the summary are not sent again.
func TestMessagesCoveredByTheSummaryAreNotResent(t *testing.T) {
	old, newer := uuid.New(), uuid.New()
	history := []runtime.ChatMessage{
		{ID: old, Role: runtime.RoleUser, Content: "covered"},
		{ID: newer, Role: runtime.RoleAssistant, Content: "not covered"},
	}
	kept, overflow := splitHistory(history, &old, uuid.Nil, 10_000)
	if len(overflow) != 0 || len(kept) != 1 || kept[0].ID != newer {
		t.Fatalf("kept %v overflow %v", kept, overflow)
	}
}

// The kept history never opens on an answer whose question was summarised.
func TestKeptHistoryDoesNotStartWithAnOrphanAnswer(t *testing.T) {
	var history []runtime.ChatMessage
	for i := range 40 {
		history = append(history, runtime.ChatMessage{
			ID: uuid.New(), Role: []string{runtime.RoleUser, runtime.RoleAssistant}[i%2],
			Content: strings.Repeat("x", 900+i*7),
		})
	}
	kept, overflow := splitHistory(history, nil, uuid.Nil, 3000)
	if len(overflow) == 0 || len(kept) == 0 {
		t.Fatalf("kept %d overflow %d", len(kept), len(overflow))
	}
	if kept[0].Role != runtime.RoleUser {
		t.Fatalf("kept history opens with %s", kept[0].Role)
	}
}

// A tool result too long for the prompt keeps its head and tail.
func TestALongToolResultIsCappedHeadAndTail(t *testing.T) {
	long := "HEAD\n" + strings.Repeat("middle line\n", 5000) + "TAIL"
	got := capToolOutput(long, 2000)
	if len([]rune(got)) > 2200 || !strings.HasPrefix(got, "HEAD") || !strings.HasSuffix(got, "TAIL") ||
		!strings.Contains(got, "left out to fit") {
		t.Fatalf("capped to %d runes: %q…", len([]rune(got)), got[:80])
	}
	if capToolOutput("short", 2000) != "short" {
		t.Fatal("a short result was changed")
	}
}

// The answer keeps how it was found and what to do next.
func TestTheAnswerStoresItsWorkAndFollowUps(t *testing.T) {
	src := citations.Source{Kind: citations.KindChunk, ID: uuid.NewString(), Title: "te-bao.md"}
	tool := &scriptedTool{name: "rag_search", result: runtime.ToolResult{
		Content: "passage", Sources: []citations.Source{src}, Retrieved: true,
	}}
	provider := &scriptProvider{reply: func(n int, _ runtime.ChatRequest, _ func(runtime.StreamChunk)) (*runtime.ChatResponse, error) {
		if n == 0 {
			return &runtime.ChatResponse{FinishReason: "tool_calls", ToolCalls: []runtime.ToolCall{
				toolCall("a", "rag_search", map[string]any{"query": "ty thể"}),
			}}, nil
		}
		return answer("Ty thể tạo ATP [[cite:chunk:" + src.ID + "]]."), nil
	}}
	capability, tc, bus, store := build(t, provider, tool)
	if err := capability.Run(context.Background(), tc); err != nil {
		t.Fatal(err)
	}
	stored, _ := store.last()
	att := storedAttachments(t, stored)
	var work workRecord
	_ = json.Unmarshal(att["work"], &work)
	if len(work.Steps) != 1 || work.Steps[0].Detail != "ty thể" || work.Steps[0].Found != 1 {
		t.Fatalf("work = %+v", work)
	}
	if string(att["suggestions"]) != `["check","simpler","example"]` {
		t.Fatalf("suggestions = %s", att["suggestions"])
	}
	for _, ev := range events(bus) {
		if ev.Type == runtime.EvResult && ev.Metadata["suggestions"] == nil {
			t.Fatal("the result event carries no suggestions")
		}
	}
}

func TestSuggestionsFollowWhatTheTurnDid(t *testing.T) {
	searched := &workRecord{Steps: []workStep{{Tool: "rag_search"}}}
	cases := []struct {
		name     string
		cited    int
		work     *workRecord
		kbs      bool
		handover bool
		want     string
	}{
		{"cited", 2, searched, true, false, "check,simpler,example"},
		{"searched, found nothing", 0, searched, true, false, "broaden"},
		{"no knowledge base", 0, &workRecord{}, false, false, ""},
		{"a handover block", 2, searched, true, true, ""},
	}
	for _, c := range cases {
		got := strings.Join(suggestionsFor(c.cited, c.work, c.kbs, c.handover), ",")
		if got != c.want {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}
}

func TestContextWindowIsConservativeForUnknownModels(t *testing.T) {
	if contextWindow("qwen2.5-coder:7b") != 262_144 {
		t.Fatal("qwen")
	}
	if contextWindow("my-local-model") != defaultContextWindow {
		t.Fatal("unknown")
	}
	if historyBudget(1_000_000) != historyCeiling {
		t.Fatal("a large window is not clamped")
	}
}

type funcTool struct {
	name string
	fn   func(map[string]any) runtime.ToolResult
}

func (t *funcTool) Name() string       { return t.name }
func (t *funcTool) NeedsNetwork() bool { return false }
func (t *funcTool) Definition() runtime.ToolDefinition {
	return runtime.ToolDefinition{Type: "function", Function: runtime.ToolFunctionSchema{
		Name: t.name, Parameters: map[string]any{"type": "object"},
	}}
}
func (t *funcTool) Execute(_ context.Context, args map[string]any, _ runtime.ToolInput) (runtime.ToolResult, error) {
	return t.fn(args), nil
}

type preferringResolver struct {
	resolver
	preferred uuid.UUID
}

func (r *preferringResolver) ChatPreferring(_ context.Context, _ uuid.UUID, _ string, id uuid.UUID, _ string) (runtime.ChatProvider, error) {
	r.preferred = id
	return r.provider, nil
}

// A conversation pinned to a connection asks the resolver for that one first.
func TestAPinnedConversationAsksForItsConnectionFirst(t *testing.T) {
	provider := &scriptProvider{reply: func(int, runtime.ChatRequest, func(runtime.StreamChunk)) (*runtime.ChatResponse, error) {
		return answer("ok"), nil
	}}
	capability, tc, _, _ := build(t, provider)
	pin := uuid.New()
	tc.Session.ConnectionID = &pin
	r := &preferringResolver{resolver: resolver{provider: provider}}
	tc.Providers = r
	if err := capability.Run(context.Background(), tc); err != nil {
		t.Fatal(err)
	}
	if r.preferred != pin {
		t.Fatalf("preferred %v, want %v", r.preferred, pin)
	}
}
