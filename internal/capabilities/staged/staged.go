// Package staged is the shared machinery of AnyTools' STAGED capabilities —
// solve and research — whose turn is a fixed sequence of model calls rather
// than chat's open think → tool → observe loop.
//
// It owns the three things both got wrong in drafts when each wrote its own:
// recording which lane actually answered after EVERY call (RT-14 — the chain
// can fall over between the first stage and the last), charging every call to
// the turn's token budget, and bracketing each stage with stage_start/stage_end
// so the UI can show progress without inferring it from event order.
package staged

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/D0bby999/anytools/internal/capabilities/modeljson"
	"github.com/D0bby999/anytools/internal/runtime"
)

// ErrBadOutput is a model reply the stage could not use: no JSON where JSON was
// asked for, or JSON of the wrong shape. The turn fails with CAPABILITY_ERROR,
// which is not retryable — the same prompt on the same model tends to fail the
// same way, and a retry button would spend the user's key proving it.
var ErrBadOutput = errors.New("the model did not return a usable reply")

// Model is one turn's resolved provider.
type Model struct {
	tc       *runtime.TurnContext
	provider runtime.ChatProvider
	source   string
}

// Resolve looks up the user's chain for a byok route function and records it on
// the turn. A user with nothing routed gets runtime.ErrNoProvider, which the
// orchestrator reports as NO_PROVIDER: fixable in Settings, not by retrying.
func Resolve(ctx context.Context, tc *runtime.TurnContext, function string) (*Model, error) {
	provider, err := tc.Providers.ChatFor(ctx, tc.Turn.UserID, function)
	if err != nil {
		if errors.Is(err, runtime.ErrNoProvider) {
			return nil, err
		}
		return nil, fmt.Errorf("%w: %s", runtime.ErrNoProvider, err)
	}
	m := &Model{tc: tc, provider: provider, source: tc.Turn.Capability}
	m.record()
	tc.Emit(runtime.Event{
		Type: runtime.EvSessionMeta, Source: m.source,
		Metadata: map[string]any{"provider": provider.Name(), "model": m.name()},
	})
	return m, nil
}

// name is the session's explicit model choice, or the chain's.
func (m *Model) name() string {
	if hint := m.tc.Session.ModelHint; hint != "" {
		return hint
	}
	return m.provider.DefaultModel()
}

func (m *Model) record() { m.tc.RecordProvider(m.provider.Name(), m.name()) }

// Stage emits stage_start and returns the func that emits its stage_end.
func Stage(tc *runtime.TurnContext, name string) func() {
	tc.Emit(runtime.Event{Type: runtime.EvStageStart, Stage: name, Source: tc.Turn.Capability})
	return func() {
		tc.Emit(runtime.Event{Type: runtime.EvStageEnd, Stage: name, Source: tc.Turn.Capability})
	}
}

// JSON makes one non-streaming call and decodes the reply's JSON object into
// out. images, when present, ride on the user message.
//
// Non-streaming on purpose, for the reason internal/capabilities/quiz gives:
// nobody watches a JSON plan assemble token by token.
func (m *Model) JSON(ctx context.Context, stage, system, user string, images []runtime.Image, out any) error {
	resp, err := m.call(ctx, stage, runtime.ChatRequest{
		Model: m.name(),
		Messages: []runtime.Message{
			{Role: runtime.RoleSystem, Content: system},
			{Role: runtime.RoleUser, Content: user, Images: images},
		},
	}, nil)
	if err != nil {
		return err
	}
	payload, ok := modeljson.Extract(resp.Content)
	if !ok {
		return fmt.Errorf("%w: no JSON object in the %s reply", ErrBadOutput, stage)
	}
	if err := json.Unmarshal([]byte(payload), out); err != nil {
		return fmt.Errorf("%w: %s reply: %s", ErrBadOutput, stage, err)
	}
	return nil
}

// Stream makes one streaming call, emitting each delta as `content` under the
// stage, and returns the full text.
func (m *Model) Stream(ctx context.Context, stage, system, user string) (string, error) {
	resp, err := m.call(ctx, stage, runtime.ChatRequest{
		Model: m.name(),
		Messages: []runtime.Message{
			{Role: runtime.RoleSystem, Content: system},
			{Role: runtime.RoleUser, Content: user},
		},
	}, func(chunk runtime.StreamChunk) {
		switch {
		case chunk.Content != "":
			m.tc.EmitContent(stage, chunk.Content)
		case chunk.Thinking != "":
			m.tc.Emit(runtime.Event{Type: runtime.EvThinking, Stage: stage, Source: m.source, Content: chunk.Thinking})
		}
	})
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(resp.Content) == "" {
		return "", fmt.Errorf("%w: the %s stage produced no text", ErrBadOutput, stage)
	}
	return resp.Content, nil
}

func (m *Model) call(
	ctx context.Context, stage string, req runtime.ChatRequest, onChunk func(runtime.StreamChunk),
) (*runtime.ChatResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, runtime.ErrTurnCancelled
	}
	if m.tc.BudgetExceeded() {
		return nil, runtime.ErrTokenBudget
	}

	var (
		resp *runtime.ChatResponse
		err  error
	)
	if onChunk == nil {
		resp, err = m.provider.Chat(ctx, req)
	} else {
		resp, err = m.provider.ChatStream(ctx, req, onChunk)
	}
	if err != nil {
		if ctx.Err() != nil {
			return nil, runtime.ErrTurnCancelled
		}
		return nil, fmt.Errorf("%w: %s", runtime.ErrProvider, err)
	}
	if resp == nil {
		return nil, fmt.Errorf("%w: provider returned no response", runtime.ErrProvider)
	}
	// Re-read the lane AFTER the call: a fallback between stages is a silent
	// downgrade unless the turn row says which connection wrote the answer.
	m.record()
	m.tc.AddUsage(resp.Usage)
	if resp.Thinking != "" && onChunk == nil {
		m.tc.Emit(runtime.Event{Type: runtime.EvThinking, Stage: stage, Source: m.source, Content: resp.Thinking})
	}
	return resp, nil
}
