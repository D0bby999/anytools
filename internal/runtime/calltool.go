package runtime

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/citations"
)

// ErrToolGated is returned by CallTool for a network tool the egress gate has
// closed: the turn's context already holds retrieved document text and the
// session does not allow the web.
var ErrToolGated = errors.New("network tool gated: document text is in context and the web is not allowed")

// CallTool runs one tool a CAPABILITY chose — a staged pipeline's own step,
// not a call the model asked for — with the same trusted input, the same
// events and the same egress gate the chat loop applies to a model's calls.
//
// The gate is enforced HERE rather than left to each pipeline: a network tool
// is refused once any earlier tool in this turn returned the user's document
// text, unless the session allows the web (red-team Security 4). A pipeline
// that forgot to check would otherwise be the one place the rule did not hold.
//
// A tool ERROR (IsError) is returned as a result, not a Go error: the caller
// decides whether to carry on without it. Sources of a successful call are
// added to the turn, so they are what the answer's citations validate against.
func (tc *TurnContext) CallTool(
	ctx context.Context, stage, name string, args map[string]any, urls *citations.URLBook,
) (ToolResult, error) {
	tool, err := tc.Tools.Get(name)
	if err != nil {
		return ToolResult{}, err
	}
	if tool.NeedsNetwork() && tc.Retrieved() && !tc.Session.AllowWeb {
		return ToolResult{}, ErrToolGated
	}

	callID := "pipeline-" + uuid.NewString()[:8]
	source := tc.Turn.Capability
	tc.Emit(Event{
		Type: EvToolCall, Stage: stage, Source: source, Content: name,
		Metadata: map[string]any{"tool": name, "call_id": callID, "arguments": shortArgs(args)},
	})

	res, err := tool.Execute(ctx, args, ToolInput{
		UserID:      tc.Turn.UserID,
		SessionID:   tc.Session.ID,
		TurnID:      tc.Turn.ID,
		KBIDs:       tc.Session.KBIDs,
		AllowWeb:    tc.Session.AllowWeb,
		URLs:        urls,
		DocumentIDs: referenceIDs(tc.References()),
	})
	if err != nil {
		if ctx.Err() != nil {
			return ToolResult{}, ErrTurnCancelled
		}
		return ToolResult{}, fmt.Errorf("tool %s: %w", name, err)
	}

	if res.IsError {
		tc.Emit(Event{
			Type: EvToolResult, Stage: stage, Source: source, Content: shortText(res.Content),
			Metadata: map[string]any{"tool": name, "call_id": callID, "error": true},
		})
		return res, nil
	}

	if res.Retrieved {
		tc.markRetrieved()
	}
	tc.AddSources(res.Sources...)
	tc.Emit(Event{
		Type: EvToolResult, Stage: stage, Source: source, Content: shortText(res.Content),
		Metadata: map[string]any{"tool": name, "call_id": callID, "sources": len(res.Sources)},
	})
	return res, nil
}

// ToolAvailable reports whether CallTool would run the named tool right now:
// it is registered for this capability and, if it needs the network, the gate
// is open. A pipeline asks before a stage so it can SAY why the web was not
// used, rather than discovering it one refusal at a time.
func (tc *TurnContext) ToolAvailable(name string) bool {
	tool, err := tc.Tools.Get(name)
	if err != nil {
		return false
	}
	return !(tool.NeedsNetwork() && tc.Retrieved() && !tc.Session.AllowWeb)
}

// Retrieved reports whether any tool in this turn has put the user's document
// text into context.
func (tc *TurnContext) Retrieved() bool {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	return tc.retrieved
}

func (tc *TurnContext) markRetrieved() {
	tc.mu.Lock()
	tc.retrieved = true
	tc.mu.Unlock()
}

// shortText and shortArgs keep the event log small: the model gets the full
// tool output, the activity panel gets a line. Rune-safe, because the text
// lands in a `text` column and a split rune fails the whole batch.
func shortText(s string) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > 200 {
		return string(r[:200]) + "…"
	}
	return s
}

func shortArgs(args map[string]any) map[string]any {
	if len(args) == 0 {
		return nil
	}
	out := make(map[string]any, len(args))
	for k, v := range args {
		if s, ok := v.(string); ok {
			out[k] = shortText(s)
			continue
		}
		out[k] = v
	}
	return out
}
