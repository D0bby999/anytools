package solve

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/citations"
	solveprompts "github.com/D0bby999/anytools/internal/prompts/solve"
	"github.com/D0bby999/anytools/internal/runtime"
)

// These drive Capability.Run with a hand-built TurnContext and a provider that
// answers by stage (it recognises each stage by its system prompt). The HTTP
// path, the real BYOK chain and the database are covered in
// internal/app/solve_research_e2e_test.go.

type memoryMessages struct {
	mu     sync.Mutex
	stored []runtime.ChatMessage
}

func (m *memoryMessages) AppendMessage(_ context.Context, msg runtime.ChatMessage) (*runtime.ChatMessage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	msg.ID = uuid.New()
	m.stored = append(m.stored, msg)
	return &msg, nil
}

type stageProvider struct {
	mu       sync.Mutex
	requests map[string]runtime.ChatRequest
	reason   string // JSON the reason stage returns
	write    string
}

func (p *stageProvider) Name() string         { return "stub" }
func (p *stageProvider) DefaultModel() string { return "vision-1" }

func (p *stageProvider) Chat(ctx context.Context, req runtime.ChatRequest) (*runtime.ChatResponse, error) {
	return p.ChatStream(ctx, req, nil)
}

func (p *stageProvider) ChatStream(_ context.Context, req runtime.ChatRequest, onChunk func(runtime.StreamChunk)) (*runtime.ChatResponse, error) {
	stage := "?"
	switch req.Messages[0].Content {
	case solveprompts.Plan:
		stage = StagePlan
	case solveprompts.Reason:
		stage = StageReason
	case solveprompts.Write:
		stage = StageWrite
	}
	p.mu.Lock()
	p.requests[stage] = req
	p.mu.Unlock()

	usage := &runtime.Usage{PromptTokens: 100, CompletionTokens: 20}
	switch stage {
	case StagePlan:
		return &runtime.ChatResponse{Usage: usage, Content: "Here is the plan:\n```json\n" +
			`{"problem":"Solve $2x + 3 = 11$ for $x$.","topic":"linear equations",` +
			`"approach":["isolate x","check"],"search":"solving linear equations","unreadable":""}` + "\n```"}, nil
	case StageReason:
		return &runtime.ChatResponse{Usage: usage, Content: p.reason}, nil
	case StageWrite:
		if onChunk != nil {
			for _, part := range strings.SplitAfter(p.write, " ") {
				onChunk(runtime.StreamChunk{Content: part})
			}
		}
		return &runtime.ChatResponse{Usage: usage, Content: p.write}, nil
	}
	return nil, nil
}

type resolver struct{ provider runtime.ChatProvider }

func (r resolver) ChatFor(context.Context, uuid.UUID, string) (runtime.ChatProvider, error) {
	return r.provider, nil
}

type ragTool struct {
	mu    sync.Mutex
	calls int
	chunk string
}

func (t *ragTool) Name() string       { return "rag_search" }
func (t *ragTool) NeedsNetwork() bool { return false }
func (t *ragTool) Definition() runtime.ToolDefinition {
	return runtime.ToolDefinition{Type: "function", Function: runtime.ToolFunctionSchema{Name: "rag_search"}}
}
func (t *ragTool) Execute(context.Context, map[string]any, runtime.ToolInput) (runtime.ToolResult, error) {
	t.mu.Lock()
	t.calls++
	t.mu.Unlock()
	return runtime.ToolResult{
		Retrieved: true,
		Content:   `<document source="Algebra.pdf p.4" id="chunk:` + t.chunk + `" trust="untrusted">To solve a linear equation, undo each operation.</document>`,
		Sources:   []citations.Source{{Kind: citations.KindChunk, ID: t.chunk, Title: "Algebra.pdf", Page: 4, DocumentID: "doc-1"}},
	}, nil
}

const reasonJSON = `{"steps":[{"title":"Isolate the term","work":"$2x = 8$","cites":[]},` +
	`{"title":"Divide","work":"$x = \\frac{8}{2} = 4$","cites":[]},` +
	`{"title":"Check","work":"$2(4)+3 = 11$","cites":[]}],"final_answer":"$x = 4$",` +
	`"check":{"verdict":"","explanation":""}}`

func build(t *testing.T, p *stageProvider, params map[string]string, images []runtime.Image, kbs bool) (
	*runtime.TurnContext, *runtime.StreamBus, *memoryMessages, *ragTool,
) {
	t.Helper()
	rag := &ragTool{chunk: uuid.NewString()}
	registry := runtime.NewToolRegistry()
	registry.Register(rag)
	sessionID, userID := uuid.New(), uuid.New()
	session := runtime.Session{ID: sessionID, UserID: userID}
	if kbs {
		session.KBIDs = []uuid.UUID{uuid.New()}
	}
	bus := runtime.NewStreamBus(uuid.New(), sessionID)
	tc := &runtime.TurnContext{
		Turn:      runtime.Turn{ID: uuid.New(), UserID: userID, SessionID: sessionID, Capability: "solve"},
		Session:   session,
		Input:     "",
		Images:    images,
		Params:    params,
		Bus:       bus,
		Tools:     registry,
		Providers: resolver{provider: p},
	}
	return tc, bus, &memoryMessages{}, rag
}

func fixtureImage(t *testing.T) runtime.Image {
	t.Helper()
	raw, err := os.ReadFile("testdata/algebra.png")
	if err != nil {
		t.Fatal(err)
	}
	return runtime.Image{MimeType: "image/png", Data: base64.StdEncoding.EncodeToString(raw)}
}

func events(bus *runtime.StreamBus) []runtime.Event {
	replay, _, cancel := bus.Subscribe(0)
	cancel()
	return replay
}

// The photographed-problem path: the image reaches the plan and reason calls,
// the stages are bracketed in order, the material is searched and cited, and
// the stored message carries the final answer the "turn into a question" and
// "save" actions read back.
func TestSolveAPhotographedProblemInThreeStages(t *testing.T) {
	provider := &stageProvider{requests: map[string]runtime.ChatRequest{}, reason: reasonJSON}
	img := fixtureImage(t)
	tc, bus, msgs, rag := build(t, provider, nil, []runtime.Image{img}, true)
	provider.write = "Solve $2x + 3 = 11$.\n\n1. **Isolate** $2x = 8$ — undo each operation [[cite:chunk:" +
		rag.chunk + "]].\n2. **Divide** $x = 4$ [[cite:chunk:" + uuid.NewString() + "]].\n\n**Answer:** $x = 4$"

	if err := New(msgs).Run(context.Background(), tc); err != nil {
		t.Fatalf("Run: %v", err)
	}

	for _, stage := range []string{StagePlan, StageReason} {
		req := provider.requests[stage]
		if len(req.Messages) != 2 || len(req.Messages[1].Images) != 1 || req.Messages[1].Images[0].Data != img.Data {
			t.Fatalf("%s: the photo did not reach the model: %+v", stage, req.Messages)
		}
	}
	if w := provider.requests[StageWrite]; len(w.Messages[1].Images) != 0 {
		t.Error("the write stage re-sent the photo; it works from the reasoning")
	}
	if !strings.Contains(provider.requests[StageReason].Messages[1].Content, "undo each operation") {
		t.Error("the retrieved passage did not reach the reasoning")
	}
	if rag.calls != 1 {
		t.Errorf("rag_search ran %d times, want 1", rag.calls)
	}

	var order []string
	var result runtime.Event
	for _, ev := range events(bus) {
		switch ev.Type {
		case runtime.EvStageStart:
			order = append(order, "+"+ev.Stage)
		case runtime.EvStageEnd:
			order = append(order, "-"+ev.Stage)
		case runtime.EvResult:
			result = ev
		}
	}
	if got := strings.Join(order, " "); got != "+plan -plan +reason -reason +write -write" {
		t.Fatalf("stage order = %s", got)
	}
	if strings.Count(result.Content, "[[cite:") != 1 || result.Metadata["dropped_citations"] != 1 {
		t.Fatalf("result = %q %v; the invented citation must be dropped, the real one kept", result.Content, result.Metadata)
	}
	if result.Metadata["final_answer"] != "$x = 4$" {
		t.Errorf("final answer = %v", result.Metadata["final_answer"])
	}

	if len(msgs.stored) != 1 {
		t.Fatalf("stored %d messages", len(msgs.stored))
	}
	var att struct {
		Sources []citations.Source `json:"sources"`
		Solve   Result             `json:"solve"`
	}
	if err := json.Unmarshal(msgs.stored[0].Attachments, &att); err != nil {
		t.Fatal(err)
	}
	if len(att.Sources) != 1 || att.Solve.FinalAnswer != "$x = 4$" || att.Solve.Problem != "Solve $2x + 3 = 11$ for $x$." {
		t.Fatalf("attachments = %+v", att)
	}
	if u := tc.Usage(); u.PromptTokens != 300 {
		t.Errorf("usage = %+v; every stage must be charged to the turn", u)
	}
}

func TestCheckMyAnswerCarriesTheLearnersAnswerAndAVerdict(t *testing.T) {
	provider := &stageProvider{
		requests: map[string]runtime.ChatRequest{},
		reason: `{"steps":[{"title":"Work it","work":"$x=4$"}],"final_answer":"$x = 4$",` +
			`"check":{"verdict":"Incorrect","explanation":"You added 3 instead of subtracting it."}}`,
		write: "Your answer is incorrect: you added 3.\n\n**Answer:** $x = 4$",
	}
	tc, bus, msgs, rag := build(t, provider,
		map[string]string{"variant": VariantCheck, "user_answer": "x = 7"}, nil, false)
	tc.Input = "2x + 3 = 11"

	if err := New(msgs).Run(context.Background(), tc); err != nil {
		t.Fatalf("Run: %v", err)
	}
	for _, stage := range []string{StagePlan, StageReason} {
		if !strings.Contains(provider.requests[stage].Messages[1].Content, "x = 7") {
			t.Errorf("%s never saw the learner's answer", stage)
		}
	}
	if rag.calls != 0 {
		t.Error("a session with no knowledge bases was searched")
	}
	var verdict any
	for _, ev := range events(bus) {
		if ev.Type == runtime.EvResult {
			verdict = ev.Metadata["verdict"]
		}
	}
	if verdict != "incorrect" {
		t.Fatalf("verdict = %v, want normalised 'incorrect'", verdict)
	}
}

func TestAReasoningWithNoStepsFailsTheTurn(t *testing.T) {
	provider := &stageProvider{requests: map[string]runtime.ChatRequest{}, reason: `{"steps":[],"final_answer":""}`}
	tc, _, msgs, _ := build(t, provider, nil, nil, false)
	tc.Input = "2x + 3 = 11"
	if err := New(msgs).Run(context.Background(), tc); err == nil {
		t.Fatal("an empty reasoning was written up")
	}
	if len(msgs.stored) != 0 {
		t.Fatal("a failed solve stored a message")
	}
}
