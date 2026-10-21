package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/providers"
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
//
// What postclaw's agent loop taught, kept here (plan 261019-1015):
//   - history is sized in tokens against the model's window, and what no
//     longer fits is summarised rather than forgotten (history.go);
//   - a "context length exceeded" refusal shrinks the prompt and retries once;
//   - each tool result is capped before it enters the prompt;
//   - several calls in one response run concurrently;
//   - the same call twice in a turn is answered from the first result;
//   - running out of rounds asks for an answer from what was found, and an
//     answer cut at the token limit is continued once;
//   - text that already streamed is kept when the provider fails after it.
func (c *Capability) Run(ctx context.Context, tc *runtime.TurnContext) error {
	started := time.Now()
	provider, err := chatProvider(ctx, tc)
	if err != nil {
		if errors.Is(err, runtime.ErrNoProvider) {
			return err
		}
		return fmt.Errorf("%w: %s", runtime.ErrNoProvider, err)
	}

	model := resolveModel(tc, provider)
	tc.RecordProvider(provider.Name(), model)
	window := contextWindow(model)

	history, err := c.messages.History(ctx, tc.Turn.UserID, tc.Session.ID, historyFetch)
	if err != nil {
		return fmt.Errorf("load history: %w", err)
	}

	// The notes that sit right after the system prompt: the linked learning
	// state, then the learner's Preferences. Read once; a rebuild after an
	// overflow reuses them.
	var notes []string
	stateNote, revision, err := c.stateContext(ctx, tc)
	if err != nil {
		return err
	}
	if note := c.profileNote(ctx, tc); note != "" {
		notes = append(notes, note)
	}
	if stateNote != "" {
		notes = append(notes, stateNote)
	}
	if note := referencesNote(tc.References()); note != "" {
		notes = append(notes, note)
	}

	work := &workRecord{}
	summary := tc.Session.Summary
	summaryThrough := tc.Session.SummaryThroughID

	// base builds everything before this turn's own tool rounds, inside a
	// history budget. It summarises what falls out, at most once per budget.
	base := func(budget int) []runtime.Message {
		kept, overflow := splitHistory(history, summaryThrough, tc.InputMessageID, budget)
		if len(overflow) > 0 {
			if s, ok := c.summarize(ctx, tc, provider, model, summary, overflow); ok {
				summary = s
				through := overflow[len(overflow)-1].ID
				summaryThrough = &through
				work.Summarised += len(overflow)
				tc.Emit(runtime.Event{
					Type: runtime.EvProgress, Stage: stagePlanning, Source: c.Name(),
					Content:  "summarised earlier messages",
					Metadata: map[string]any{"kind": "compaction", "messages": len(overflow)},
				})
			}
		}
		return buildMessages(tc.Session, summary, notes, kept, history, tc.Input, tc.InputMessageID)
	}

	budget := historyBudget(window)
	msgs := base(budget)
	var turnMsgs []runtime.Message
	overflowRetried := false
	work.ContextTokens, work.ContextWindow = promptTokens(msgs), window
	work.HistoryBudget = budget

	tc.Emit(runtime.Event{
		Type:   runtime.EvSessionMeta,
		Source: c.Name(),
		Metadata: map[string]any{
			"provider": provider.Name(), "model": model,
			"context_tokens": work.ContextTokens, "context_window": window,
		},
	})

	// hasRetrievedContext gates network tools: once untrusted document text is
	// in the context, a network tool is only mounted with the session's
	// explicit "allow web" consent (red-team Security 4).
	hasRetrievedContext := false
	seen := map[string]string{}
	var answer string

	tc.Emit(runtime.Event{Type: runtime.EvStageStart, Stage: stagePlanning, Source: c.Name()})

	// call makes one model request over the current prompt. A context
	// overflow is recovered once: the history is rebuilt at a third of its
	// budget and this turn's tool output is cut harder, then the call repeats.
	call := func(tools []runtime.ToolDefinition) (*runtime.ChatResponse, error) {
		for {
			req := runtime.ChatRequest{Messages: concat(msgs, turnMsgs), Tools: tools, Model: model}
			resp, partial, err := c.callProvider(ctx, tc, provider, req)
			if err == nil {
				// Re-read the lane AFTER the call. The resolver hands back the
				// user's whole fallback chain as one provider, so which
				// connection answered, and on which model, is only knowable
				// now; writing the first choice onto the turn row is the silent
				// downgrade RT-14 exists to make visible.
				tc.RecordProvider(provider.Name(), resolveModel(tc, provider))
				tc.AddUsage(resp.Usage)
				return resp, nil
			}
			if !overflowRetried && partial == "" && isOverflow(err) {
				overflowRetried = true
				budget /= 3
				msgs = base(budget)
				for i := range turnMsgs {
					if turnMsgs[i].Role == runtime.RoleTool {
						turnMsgs[i].Content = capToolOutput(turnMsgs[i].Content, toolOutputRetryChars)
					}
				}
				tc.Emit(runtime.Event{
					Type: runtime.EvProgress, Stage: stagePlanning, Source: c.Name(),
					Content:  "the conversation was too long for the model; shortened it and tried again",
					Metadata: map[string]any{"kind": "overflow_retry"},
				})
				continue
			}
			if partial != "" {
				c.keepPartial(ctx, tc, partial, work, started)
			}
			if errors.Is(err, runtime.ErrTurnCancelled) {
				return nil, err
			}
			return nil, fmt.Errorf("%w: %s", runtime.ErrProvider, err)
		}
	}

	for round := 0; round < runtime.MaxToolRounds; round++ {
		if err := ctx.Err(); err != nil {
			return runtime.ErrTurnCancelled
		}
		if tc.BudgetExceeded() {
			return runtime.ErrTokenBudget
		}
		work.Rounds++

		resp, err := call(tc.Tools.Definitions(tc.Session.AllowWeb, hasRetrievedContext))
		if err != nil {
			return err
		}
		if resp.Thinking != "" {
			tc.Emit(runtime.Event{Type: runtime.EvThinking, Stage: stagePlanning,
				Source: c.Name(), Content: resp.Thinking})
		}

		if len(resp.ToolCalls) == 0 {
			answer = resp.Content
			if resp.FinishReason == "length" && answer != "" && !tc.BudgetExceeded() {
				answer = c.continueAnswer(ctx, tc, call, &turnMsgs, answer, work)
			}
			break
		}

		// The model wants tools: record its turn verbatim, then run them.
		turnMsgs = append(turnMsgs, runtime.Message{
			Role:      runtime.RoleAssistant,
			Content:   resp.Content,
			Thinking:  resp.Thinking,
			ToolCalls: resp.ToolCalls,
		})

		outcomes, err := c.runTools(ctx, tc, resp.ToolCalls, seen, work)
		if err != nil {
			return err
		}
		for i, tcall := range resp.ToolCalls {
			if outcomes[i].retrieved {
				hasRetrievedContext = true
			}
			turnMsgs = append(turnMsgs, runtime.Message{
				Role:       runtime.RoleTool,
				ToolCallID: tcall.ID,
				Content:    outcomes[i].content,
			})
		}
	}

	// Out of rounds: one more call, with no tools, for an answer from what
	// was found. Eight rounds of searching that end in an error and nothing
	// else are the worst use of a learner's key.
	if answer == "" && !tc.BudgetExceeded() && ctx.Err() == nil {
		work.LimitReached = true
		turnMsgs = append(turnMsgs, runtime.Message{Role: runtime.RoleSystem, Content: roundLimitNote})
		resp, err := call(nil)
		if err != nil {
			return err
		}
		if len(resp.ToolCalls) == 0 {
			answer = resp.Content
		}
	}

	if answer == "" {
		if tc.BudgetExceeded() {
			return runtime.ErrTokenBudget
		}
		return runtime.ErrToolRoundLimit
	}

	tc.Emit(runtime.Event{Type: runtime.EvStageEnd, Stage: stagePlanning, Source: c.Name()})
	work.MS = time.Since(started).Milliseconds()
	return c.deliver(ctx, tc, answer, revision, work)
}

// chatProvider resolves the chat route, with the conversation's picked
// connection first when it has one and the resolver can honour it.
func chatProvider(ctx context.Context, tc *runtime.TurnContext) (runtime.ChatProvider, error) {
	if pin := tc.Session.ConnectionID; pin != nil {
		if pr, ok := tc.Providers.(runtime.PreferringResolver); ok {
			return pr.ChatPreferring(ctx, tc.Turn.UserID, "chat", *pin, tc.Session.ModelHint)
		}
	}
	return tc.Providers.ChatFor(ctx, tc.Turn.UserID, "chat")
}

// roundLimitNote is the instruction for the call after the last tool round.
const roundLimitNote = "You have used every tool round for this question. Do not call tools. " +
	"Answer now from what the tools returned above, with its citations, and say plainly what you could not find."

// continueNote asks for the rest of an answer cut at the output limit.
const continueNote = "Your answer was cut off at the output limit. Continue exactly where it stopped, " +
	"without repeating anything and without any preamble."

// continueAnswer asks once for the rest of an answer that hit the output
// limit and appends it. A failed continuation keeps what there is.
func (c *Capability) continueAnswer(
	ctx context.Context, tc *runtime.TurnContext,
	call func([]runtime.ToolDefinition) (*runtime.ChatResponse, error),
	turnMsgs *[]runtime.Message, answer string, work *workRecord,
) string {
	*turnMsgs = append(*turnMsgs,
		runtime.Message{Role: runtime.RoleAssistant, Content: answer},
		runtime.Message{Role: runtime.RoleUser, Content: continueNote},
	)
	resp, err := call(nil)
	if err != nil || resp == nil || resp.Content == "" {
		return answer
	}
	work.Continued = true
	return answer + resp.Content
}

// callProvider streams one model call, emitting content deltas as they arrive.
//
// The deltas are emitted DURING the call rather than after it: that is the
// whole point of the stream, and a capability that collected the response first
// would make the SSE endpoint an expensive way to deliver one message. On an
// error it also returns the text this call had already streamed, so the
// caller can keep it.
func (c *Capability) callProvider(
	ctx context.Context, tc *runtime.TurnContext,
	provider runtime.ChatProvider, req runtime.ChatRequest,
) (*runtime.ChatResponse, string, error) {
	var streamed strings.Builder
	resp, err := provider.ChatStream(ctx, req, func(chunk runtime.StreamChunk) {
		switch {
		case chunk.Content != "":
			streamed.WriteString(chunk.Content)
			tc.EmitContent(stageAnswering, chunk.Content)
		case chunk.Thinking != "":
			tc.Emit(runtime.Event{Type: runtime.EvThinking, Stage: stagePlanning,
				Source: c.Name(), Content: chunk.Thinking})
		}
	})
	if err != nil {
		if ctx.Err() != nil {
			return nil, streamed.String(), runtime.ErrTurnCancelled
		}
		return nil, streamed.String(), err
	}
	if resp == nil {
		return nil, streamed.String(), errors.New("provider returned no response")
	}
	return resp, "", nil
}

// isOverflow reports a provider refusal because the prompt did not fit.
func isOverflow(err error) bool {
	return providers.IsContextOverflow(err)
}

// keepPartial stores the text a failed or stopped call had already streamed,
// marked incomplete. The learner watched it arrive; a failure that then erased
// it would take away something they had already read. The turn still ends as
// failed or cancelled, so the error and its Retry stay on screen beside it.
func (c *Capability) keepPartial(ctx context.Context, tc *runtime.TurnContext, partial string, work *workRecord, started time.Time) {
	res := citations.Validate(partial, citations.Index(tc.Sources()))
	if strings.TrimSpace(res.Text) == "" {
		return
	}
	work.MS = time.Since(started).Milliseconds()
	attachments, _ := json.Marshal(map[string]any{"sources": res.Sources, "work": work, "incomplete": true, "served": served(tc)})
	writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if _, err := c.messages.AppendMessage(writeCtx, runtime.ChatMessage{
		UserID: tc.Turn.UserID, SessionID: tc.Session.ID, Role: runtime.RoleAssistant,
		Content: res.Text, Capability: c.Name(), Attachments: attachments,
	}); err != nil {
		slog.Warn("chat: keep partial answer", "error", err, "turn", tc.Turn.ID)
	}
}

// served is who answered, kept on the answer so a rating of it names the
// provider and model server-side (chat_feedback).
func served(tc *runtime.TurnContext) map[string]string {
	provider, model := tc.Served()
	return map[string]string{"provider": provider, "model": model}
}

func concat(a, b []runtime.Message) []runtime.Message {
	out := make([]runtime.Message, 0, len(a)+len(b))
	return append(append(out, a...), b...)
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

// deliver validates the answer's citations, emits `sources` and `result`, and
// writes the assistant message.
//
// Validation happens BEFORE the message is stored, so an unverifiable citation
// never reaches the transcript — not just the screen. A marker dropped here is
// gone from history too, which is what makes "every citation in this product
// opens something" a property rather than an aspiration.
//
// The message also keeps how the answer was found (work) and the follow-ups
// to offer (suggestions), so a reload shows both without the event log.
func (c *Capability) deliver(ctx context.Context, tc *runtime.TurnContext, answer, revision string, work *workRecord) error {
	res := citations.Validate(answer, citations.Index(tc.Sources()))

	if len(res.Sources) > 0 {
		tc.Emit(runtime.Event{
			Type: runtime.EvSources, Stage: stageAnswering, Source: c.Name(),
			Metadata: map[string]any{"sources": res.Sources},
		})
	}

	meta := map[string]any{"dropped_citations": len(res.Dropped), "work": work}
	check := handoverCheck(res.Text, revision, tc.Session.LearningStateID)
	if check != nil {
		meta["handover"] = check
	}
	followUps := suggestionsFor(len(res.Sources), work, len(tc.Session.KBIDs) > 0, check != nil)
	if len(followUps) > 0 {
		meta["suggestions"] = followUps
	}
	tc.Emit(runtime.Event{
		Type: runtime.EvResult, Stage: stageAnswering, Source: c.Name(),
		Content:  res.Text,
		Metadata: meta,
	})
	tc.Emit(runtime.Event{Type: runtime.EvStageEnd, Stage: stageAnswering, Source: c.Name()})

	stored := map[string]any{"sources": res.Sources, "work": work, "served": served(tc)}
	if len(followUps) > 0 {
		stored["suggestions"] = followUps
	}
	attachments, _ := json.Marshal(stored)
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
