package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/runtime"
)

// Stages a chat turn moves through. They bracket the stream with stage_start /
// stage_end so a UI can label what it is showing without guessing from event
// order.
const (
	stagePlanning  = "planning"
	stageAnswering = "answering"
)

// MessageStore is the transcript persistence this capability needs.
type MessageStore interface {
	// History returns the session's messages oldest-first, capped at limit.
	History(ctx context.Context, userID, sessionID uuid.UUID, limit int) ([]runtime.ChatMessage, error)
	// AppendMessage writes one message and returns it with its id.
	AppendMessage(ctx context.Context, m runtime.ChatMessage) (*runtime.ChatMessage, error)
}

// historyLimit caps how far back a turn reads. Context compaction is a later
// concern; a hard cap is the honest version of it for now, and it is applied to
// the OLDEST messages so the recent conversation always survives.
const historyLimit = 40

// Capability is the grounded chat loop.
type Capability struct {
	messages MessageStore
	// states is phase 10's learning-state reader; nil disables the resume
	// injection (state_context.go).
	states LearningStates
	// profile is learning-depth phase 9's preferences reader; nil reads no
	// profile (profile.go).
	profile LearnerProfile
}

// New builds the capability.
func New(messages MessageStore) *Capability { return &Capability{messages: messages} }

// Name implements runtime.Capability.
func (c *Capability) Name() string { return "chat" }

// Run implements runtime.Capability: think → tool → observe until the model
// answers, the round limit is hit, or the budget runs out.
func (c *Capability) Run(ctx context.Context, tc *runtime.TurnContext) error {
	provider, err := tc.Providers.ChatFor(ctx, tc.Turn.UserID, "chat")
	if err != nil {
		if errors.Is(err, runtime.ErrNoProvider) {
			return err
		}
		return fmt.Errorf("%w: %s", runtime.ErrNoProvider, err)
	}

	model := resolveModel(tc, provider)
	tc.RecordProvider(provider.Name(), model)
	tc.Emit(runtime.Event{
		Type:     runtime.EvSessionMeta,
		Source:   c.Name(),
		Metadata: map[string]any{"provider": provider.Name(), "model": model},
	})

	history, err := c.messages.History(ctx, tc.Turn.UserID, tc.Session.ID, historyLimit)
	if err != nil {
		return fmt.Errorf("load history: %w", err)
	}
	msgs := buildMessages(tc.Session, history, tc.Input, tc.InputMessageID)

	// A session linked to a learning state is shown that state, right after
	// the system prompt and before any history, on every turn.
	stateNote, revision, err := c.stateContext(ctx, tc)
	if err != nil {
		return err
	}
	if stateNote != "" {
		msgs = append(msgs[:1], append([]runtime.Message{{Role: runtime.RoleSystem, Content: stateNote}}, msgs[1:]...)...)
	}
	// The learner's Preferences, when they have set any, go right after the
	// system prompt too — pulled for this turn, never stored in history.
	if note := c.profileNote(ctx, tc); note != "" {
		msgs = append(msgs[:1], append([]runtime.Message{{Role: runtime.RoleSystem, Content: note}}, msgs[1:]...)...)
	}

	// hasRetrievedContext gates network tools: once untrusted document text is
	// in the context, a network tool is only mounted with the session's
	// explicit "allow web" consent (red-team Security 4).
	hasRetrievedContext := false
	var answer string

	tc.Emit(runtime.Event{Type: runtime.EvStageStart, Stage: stagePlanning, Source: c.Name()})

	for round := 0; round < runtime.MaxToolRounds; round++ {
		if err := ctx.Err(); err != nil {
			return runtime.ErrTurnCancelled
		}
		if tc.BudgetExceeded() {
			return runtime.ErrTokenBudget
		}

		req := runtime.ChatRequest{
			Messages: msgs,
			Tools:    tc.Tools.Definitions(tc.Session.AllowWeb, hasRetrievedContext),
			Model:    model,
		}

		resp, err := c.callProvider(ctx, tc, provider, req)
		if err != nil {
			return err
		}
		// Re-read the lane AFTER the call. The resolver hands back the user's
		// whole fallback chain as one provider, so which connection actually
		// answered — and on which model — is not knowable until it has. Writing
		// only the first choice onto the turn row is precisely the silent
		// downgrade RT-14 exists to make visible, and AC3 reads this back.
		tc.RecordProvider(provider.Name(), resolveModel(tc, provider))
		tc.AddUsage(resp.Usage)

		if resp.Thinking != "" {
			tc.Emit(runtime.Event{Type: runtime.EvThinking, Stage: stagePlanning,
				Source: c.Name(), Content: resp.Thinking})
		}

		if len(resp.ToolCalls) == 0 {
			answer = resp.Content
			break
		}

		// The model wants tools: record its turn verbatim, then run them.
		msgs = append(msgs, runtime.Message{
			Role:      runtime.RoleAssistant,
			Content:   resp.Content,
			Thinking:  resp.Thinking,
			ToolCalls: resp.ToolCalls,
		})

		for _, call := range resp.ToolCalls {
			result, askErr := c.runTool(ctx, tc, call)
			if askErr != nil {
				return askErr
			}
			if result.retrieved {
				hasRetrievedContext = true
			}
			msgs = append(msgs, runtime.Message{
				Role:       runtime.RoleTool,
				ToolCallID: call.ID,
				Content:    result.content,
			})
		}
	}

	if answer == "" {
		return runtime.ErrToolRoundLimit
	}

	tc.Emit(runtime.Event{Type: runtime.EvStageEnd, Stage: stagePlanning, Source: c.Name()})
	return c.deliver(ctx, tc, answer, revision)
}

// callProvider streams one model call, emitting content deltas as they arrive.
//
// The deltas are emitted DURING the call rather than after it: that is the
// whole point of the stream, and a capability that collected the response first
// would make the SSE endpoint an expensive way to deliver one message.
func (c *Capability) callProvider(
	ctx context.Context, tc *runtime.TurnContext,
	provider runtime.ChatProvider, req runtime.ChatRequest,
) (*runtime.ChatResponse, error) {
	resp, err := provider.ChatStream(ctx, req, func(chunk runtime.StreamChunk) {
		switch {
		case chunk.Content != "":
			tc.EmitContent(stageAnswering, chunk.Content)
		case chunk.Thinking != "":
			tc.Emit(runtime.Event{Type: runtime.EvThinking, Stage: stagePlanning,
				Source: c.Name(), Content: chunk.Thinking})
		}
	})
	if err != nil {
		if ctx.Err() != nil {
			return nil, runtime.ErrTurnCancelled
		}
		return nil, fmt.Errorf("%w: %s", runtime.ErrProvider, err)
	}
	if resp == nil {
		return nil, fmt.Errorf("%w: provider returned no response", runtime.ErrProvider)
	}
	return resp, nil
}

// resolveModel is the session's explicit choice, or whatever the provider says
// it will use. Called before the first request and again after every response,
// because the second answer can differ from the first: see RecordProvider above.
func resolveModel(tc *runtime.TurnContext, provider runtime.ChatProvider) string {
	if hint := tc.Session.ModelHint; hint != "" {
		return hint
	}
	return provider.DefaultModel()
}

type toolOutcome struct {
	content   string
	retrieved bool
}

// runTool executes one tool call and emits the tool_call / tool_result pair.
//
// A tool ERROR is returned to the model as tool content, not raised: a foreign
// id, a bad page number or a malformed argument is something the model should
// see and correct. Only an infrastructure failure — the retriever's database
// being down — ends the turn, because retrying that in the loop just burns
// rounds.
func (c *Capability) runTool(ctx context.Context, tc *runtime.TurnContext, call runtime.ToolCall) (toolOutcome, error) {
	tc.Emit(runtime.Event{
		Type: runtime.EvToolCall, Stage: stagePlanning, Source: c.Name(),
		Content:  call.Name,
		Metadata: map[string]any{"tool": call.Name, "call_id": call.ID, "arguments": redactArgs(call.Arguments)},
	})

	// postclaw's hard-won rule (providers/types.go:170): a call whose argument
	// JSON did not parse must NOT be dispatched. Arguments is an empty map in
	// that case, and running rag_search with no arguments is a search the user
	// never asked for.
	if call.ArgsParseError != "" {
		return c.toolFailed(tc, call, "your arguments were not valid JSON; send them again"), nil
	}

	tool, err := tc.Tools.Get(call.Name)
	if err != nil {
		return c.toolFailed(tc, call, fmt.Sprintf("there is no tool called %q in this conversation", call.Name)), nil
	}

	result, err := tool.Execute(ctx, call.Arguments, runtime.ToolInput{
		UserID:    tc.Turn.UserID,
		SessionID: tc.Session.ID,
		TurnID:    tc.Turn.ID,
		KBIDs:     tc.Session.KBIDs,
		AllowWeb:  tc.Session.AllowWeb,
	})
	if err != nil {
		if ctx.Err() != nil {
			return toolOutcome{}, runtime.ErrTurnCancelled
		}
		return toolOutcome{}, fmt.Errorf("tool %s: %w", call.Name, err)
	}

	// ask_user suspends the turn here. The answer comes back as the tool's
	// result, so from the model's point of view it asked a question and got one.
	if result.Ask != nil {
		answer, err := tc.Ask(ctx, *result.Ask)
		if err != nil {
			if errors.Is(err, runtime.ErrNoAnswer) && ctx.Err() != nil {
				return toolOutcome{}, runtime.ErrTurnCancelled
			}
			return toolOutcome{}, err
		}
		tc.Emit(runtime.Event{
			Type: runtime.EvToolResult, Stage: stagePlanning, Source: c.Name(),
			Content:  "answered",
			Metadata: map[string]any{"tool": call.Name, "call_id": call.ID},
		})
		// The user's answer is a USER instruction, and is labelled as one
		// rather than wrapped in the untrusted envelope.
		return toolOutcome{content: "The user answered: " + answer}, nil
	}

	if result.IsError {
		return c.toolFailed(tc, call, result.Content), nil
	}

	tc.AddSources(result.Sources...)
	tc.Emit(runtime.Event{
		Type: runtime.EvToolResult, Stage: stagePlanning, Source: c.Name(),
		Content: summarize(result.Content),
		Metadata: map[string]any{
			"tool": call.Name, "call_id": call.ID, "sources": len(result.Sources),
		},
	})
	if len(result.Sources) > 0 {
		tc.Emit(runtime.Event{
			Type: runtime.EvObservation, Stage: stagePlanning, Source: c.Name(),
			Content: fmt.Sprintf("%d passages retrieved", len(result.Sources)),
		})
	}

	return toolOutcome{content: result.Content, retrieved: result.Retrieved}, nil
}

func (c *Capability) toolFailed(tc *runtime.TurnContext, call runtime.ToolCall, msg string) toolOutcome {
	tc.Emit(runtime.Event{
		Type: runtime.EvToolResult, Stage: stagePlanning, Source: c.Name(),
		Content:  msg,
		Metadata: map[string]any{"tool": call.Name, "call_id": call.ID, "error": true},
	})
	return toolOutcome{content: "Tool error: " + msg}
}

// deliver validates the answer's citations, emits `sources` and `result`, and
// writes the assistant message.
//
// Validation happens BEFORE the message is stored, so an unverifiable citation
// never reaches the transcript — not just the screen. A marker dropped here is
// gone from history too, which is what makes "every citation in this product
// opens something" a property rather than an aspiration.
func (c *Capability) deliver(ctx context.Context, tc *runtime.TurnContext, answer, revision string) error {
	res := citations.Validate(answer, citations.Index(tc.Sources()))

	if len(res.Sources) > 0 {
		tc.Emit(runtime.Event{
			Type: runtime.EvSources, Stage: stageAnswering, Source: c.Name(),
			Metadata: map[string]any{"sources": res.Sources},
		})
	}

	meta := map[string]any{"dropped_citations": len(res.Dropped)}
	if check := handoverCheck(res.Text, revision, tc.Session.LearningStateID); check != nil {
		meta["handover"] = check
	}
	tc.Emit(runtime.Event{
		Type: runtime.EvResult, Stage: stageAnswering, Source: c.Name(),
		Content:  res.Text,
		Metadata: meta,
	})
	tc.Emit(runtime.Event{Type: runtime.EvStageEnd, Stage: stageAnswering, Source: c.Name()})

	attachments, _ := json.Marshal(map[string]any{"sources": res.Sources})
	if _, err := c.messages.AppendMessage(ctx, runtime.ChatMessage{
		UserID:      tc.Turn.UserID,
		SessionID:   tc.Session.ID,
		Role:        runtime.RoleAssistant,
		Content:     res.Text,
		Capability:  c.Name(),
		Attachments: attachments,
	}); err != nil {
		return fmt.Errorf("store assistant message: %w", err)
	}
	return nil
}

// summarize trims tool output for the event stream. The full text goes to the
// model; the UI's activity panel shows a line, because rendering a 20 KB
// envelope in a side panel is not information.
func summarize(s string) string {
	return truncate(strings.TrimSpace(s), 200)
}

// truncate cuts at a RUNE boundary, not a byte one.
//
// summarize's output lands in `turn_events.content`, which is `text`: Postgres
// rejects an invalid byte sequence and fails the WHOLE batch, taking every other
// event in it. A Vietnamese or CJK title straddling byte 200 is enough, and this
// product is explicitly built to carry Vietnamese.
func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}

// redactArgs keeps tool arguments out of the event log at full length. They are
// model-authored text and land in a jsonb column that a later phase will index;
// a 50 KB "query" is a cheap way to bloat every turn's log.
func redactArgs(args map[string]any) map[string]any {
	if len(args) == 0 {
		return nil
	}
	out := make(map[string]any, len(args))
	for k, v := range args {
		if s, ok := v.(string); ok && len(s) > 200 {
			out[k] = truncate(s, 200)
			continue
		}
		out[k] = v
	}
	return out
}
