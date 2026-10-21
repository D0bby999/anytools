package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"
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
//
// And what phase 5 of plan 261021-1100 added from the same source:
//   - the prompt opens with one stable system message and keeps per-turn
//     notes beside the question, so a provider's prompt cache keeps hitting
//     (prompt.go); a summary is checked for its parts before it replaces
//     the old one (compaction.go);
//   - a long tool result is kept whole for the turn and read back by page
//     (spill.go), and older results leave the prompt when it nears the
//     window;
//   - arguments are checked against the tool's schema, and each tool has a
//     time bound (tools.go, args_check.go);
//   - rounds that keep bringing nothing new end the loop, a response cut
//     for safety or at the length limit does not have its tool calls run,
//     and a model that stops sending ends the call (guard.go);
//   - one turn can ask another model on the route without re-pinning the
//     conversation.
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

	// The learner's Preferences change rarely and open the prompt with the
	// system rules; the linked learning state and the documents pointed at
	// can change every turn, so they sit beside the question (prompt.go).
	// Read once; a rebuild after an overflow reuses them.
	stateNote, revision, err := c.stateContext(ctx, tc)
	if err != nil {
		return err
	}
	notes := promptNotes{stable: c.profileNote(ctx, tc)}
	if stateNote != "" {
		notes.turn = append(notes.turn, stateNote)
	}
	if note := referencesNote(tc.References()); note != "" {
		notes.turn = append(notes.turn, note)
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
	turn := newTurnTools()
	staleRounds := 0
	var answer string

	tc.Emit(runtime.Event{Type: runtime.EvStageStart, Stage: stagePlanning, Source: c.Name()})

	// call makes one model request over the current prompt. A context
	// overflow is recovered once: the history is rebuilt at a third of its
	// budget and this turn's tool output is cut harder, then the call repeats.
	call := func(tools []runtime.ToolDefinition) (*runtime.ChatResponse, error) {
		for {
			// Near the window, earlier rounds' results leave the prompt;
			// each stays readable through its handle.
			if n := elideOlderResults(turnMsgs, turn, promptTokens(concat(msgs, turnMsgs)), window); n > 0 {
				work.Elided += n
				tc.Emit(runtime.Event{
					Type: runtime.EvProgress, Stage: stagePlanning, Source: c.Name(),
					Content:  "set earlier tool results aside to make room",
					Metadata: map[string]any{"kind": "elided", "results": n},
				})
			}
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
						turnMsgs[i].Content = shrinkToolOutput(turnMsgs[i].Content, toolOutputRetryChars, turn.book)
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
			if errors.Is(err, runtime.ErrTurnCancelled) || errors.Is(err, runtime.ErrStalled) {
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

		defs := tc.Tools.Definitions(tc.Session.AllowWeb, hasRetrievedContext)
		if !turn.book.empty() {
			defs = append(defs, readResultDefinition())
		}
		resp, err := call(defs)
		if err != nil {
			return err
		}
		// A response the provider cut for safety may hold half-formed tool
		// calls and an unfinished answer: neither is acted on, and the
		// learner is told why (postclaw safety_termination.go).
		if stoppedForSafety(resp) {
			if resp.Content != "" {
				c.keepPartial(ctx, tc, resp.Content, work, started)
			}
			return runtime.ErrSafetyStop
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

		notRun := ""
		if cutAtLength(resp) {
			notRun = cutCallsNote
		}
		before := len(work.Steps)
		outcomes, err := c.runTools(ctx, tc, resp.ToolCalls, turn, work, notRun)
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
			turn.calls[tcall.ID] = callInfo{tool: tcall.Name, retrieved: outcomes[i].retrieved}
		}

		// Rounds that bring nothing new end the loop: the model is
		// circling, and another round only spends the learner's key.
		if staleRound(work.Steps[before:]) {
			staleRounds++
		} else {
			staleRounds = 0
		}
		if staleRounds >= staleRoundLimit {
			work.Stopped = "loop"
			tc.Emit(runtime.Event{
				Type: runtime.EvProgress, Stage: stagePlanning, Source: c.Name(),
				Content:  "stopped searching: the last rounds found nothing new",
				Metadata: map[string]any{"kind": "loop_stopped", "rounds": staleRounds},
			})
			break
		}
	}

	// Out of rounds, or stopped for going in circles: one more call, with no
	// tools, for an answer from what was found. Eight rounds of searching
	// that end in an error and nothing else are the worst use of a
	// learner's key.
	if answer == "" && !tc.BudgetExceeded() && ctx.Err() == nil {
		note := roundLimitNote
		if work.Stopped == "" {
			work.LimitReached = true
		} else {
			note = loopStopNote
		}
		turnMsgs = append(turnMsgs, runtime.Message{Role: runtime.RoleSystem, Content: note})
		resp, err := call(nil)
		if err != nil {
			return err
		}
		if stoppedForSafety(resp) {
			if resp.Content != "" {
				c.keepPartial(ctx, tc, resp.Content, work, started)
			}
			return runtime.ErrSafetyStop
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
	work.CachedTokens = tc.Usage().CacheReadTokens
	return c.deliver(ctx, tc, answer, revision, work)
}

// chatProvider resolves the chat route, with this turn's pick first when it
// has one, else the conversation's, when the resolver can honour it.
func chatProvider(ctx context.Context, tc *runtime.TurnContext) (runtime.ChatProvider, error) {
	if id, err := uuid.Parse(tc.Param(runtime.ParamConnection)); err == nil {
		if pr, ok := tc.Providers.(runtime.PreferringResolver); ok {
			return pr.ChatPreferring(ctx, tc.Turn.UserID, "chat", id, tc.Param(runtime.ParamModel))
		}
	}
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
	callCtx, stop, stalled := watchStream(ctx)
	defer stop()
	resp, err := provider.ChatStream(callCtx, req, func(chunk runtime.StreamChunk) {
		stalled.touch()
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
		if after := stalled.fired(); after > 0 {
			return nil, streamed.String(), fmt.Errorf("%w for %d seconds", runtime.ErrStalled, int(after.Seconds()))
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

// resolveModel is this turn's model, the session's explicit choice, or
// whatever the provider says it will use. Called before the first request and
// again after every response, because the second answer can differ from the
// first: see RecordProvider above.
func resolveModel(tc *runtime.TurnContext, provider runtime.ChatProvider) string {
	if tc.Param(runtime.ParamConnection) != "" {
		if m := tc.Param(runtime.ParamModel); m != "" {
			return m
		}
		return provider.DefaultModel()
	}
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

// The stream guard (postclaw providers/stream_guard.go, moved up a layer so
// every provider has it): a call that sends nothing for this long is ended,
// and the turn fails as PROVIDER_STALLED with what had streamed kept. The
// first chunk may take longer, since a reasoning model thinks first; any
// chunk, thinking included, counts as the model still working.
var (
	stallBeforeFirst = 180 * time.Second
	stallBetween     = 90 * time.Second
)

// streamWatch notices a call that has gone quiet.
type streamWatch struct {
	last   atomic.Int64 // unix nanos of the last chunk, 0 before the first
	start  time.Time
	firing atomic.Int64 // the silence that ended the call, in nanos
}

func (w *streamWatch) touch() { w.last.Store(time.Now().UnixNano()) }

// fired is how long the call had been silent when it was ended, or 0.
func (w *streamWatch) fired() time.Duration { return time.Duration(w.firing.Load()) }

// watchStream returns a context for one call that is cancelled when the
// call goes quiet, a stop for when the call returns, and the watch.
func watchStream(ctx context.Context) (context.Context, func(), *streamWatch) {
	callCtx, cancel := context.WithCancel(ctx)
	w := &streamWatch{start: time.Now()}
	done := make(chan struct{})
	tick := min(stallBetween, stallBeforeFirst) / 6
	go func() {
		t := time.NewTicker(tick)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-callCtx.Done():
				return
			case now := <-t.C:
				limit, since := stallBetween, time.Unix(0, w.last.Load())
				if w.last.Load() == 0 {
					limit, since = stallBeforeFirst, w.start
				}
				if quiet := now.Sub(since); quiet >= limit {
					w.firing.Store(int64(limit))
					cancel()
					return
				}
			}
		}
	}()
	return callCtx, func() { close(done); cancel() }, w
}
