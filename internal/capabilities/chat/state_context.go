package chat

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning/loop"
	"github.com/D0bby999/anytools/internal/runtime"
)

// state_context.go is the AI-resume half of phase 10: a conversation linked to
// a learning state (chat_sessions.learning_state_id) is shown that state on
// every turn, with the resume instructions and the state's current revision.
//
// This package does not build that message. The state is quoted inside the
// same provenance envelope a retrieved passage gets (internal/tools.Wrap), and
// internal/tools' own tests import this package, so the wrapping lives in the
// wiring (internal/app/adapters_loop.go) and arrives here ready to send.

// LearningStates renders a linked state for one turn. It returns the system
// message and the revision a paste-back must echo; loop.ErrNotFound when the
// state is gone.
type LearningStates interface {
	StateContext(ctx context.Context, userID, stateID uuid.UUID) (message, revision string, err error)
}

// WithLearningStates enables the state-context injection. Without it a linked
// session is treated as unlinked — the model is told nothing rather than told
// something the capability could not read.
func (c *Capability) WithLearningStates(states LearningStates) *Capability {
	c.states = states
	return c
}

// stateContext builds the system message for a linked session. It returns
// ("", "", nil) for an unlinked one.
func (c *Capability) stateContext(ctx context.Context, tc *runtime.TurnContext) (msg, revision string, err error) {
	if c.states == nil || tc.Session.LearningStateID == nil {
		return "", "", nil
	}
	msg, revision, err = c.states.StateContext(ctx, tc.Turn.UserID, *tc.Session.LearningStateID)
	if errors.Is(err, loop.ErrNotFound) {
		// Deleted since the chat was linked (the foreign key would normally
		// unlink it). Say so, so the model does not reconstruct it from the
		// transcript and present that as the state.
		return "This conversation was linked to a learning state that no longer exists. " +
			"You have no record of it. Do not restate or reconstruct it, and do not emit a handover block.", "", nil
	}
	if err != nil {
		return "", "", fmt.Errorf("load learning state: %w", err)
	}
	return msg, revision, nil
}

// handoverCheck validates a paste-back block in the answer, if there is one,
// so the chat can show "this can be accepted" or what is wrong with it. It
// does NOT write anything: accepting is the person's act, through
// POST /v1/learning/states/{id}/handover, which validates again.
func handoverCheck(answer, revision string, stateID *uuid.UUID) map[string]any {
	if stateID == nil {
		return nil
	}
	pb, problems, err := loop.ParsePasteBack(answer)
	if errors.Is(err, loop.ErrNoPasteBack) || err != nil {
		return nil
	}
	if len(problems) == 0 && pb.Revision != revision {
		problems = []string{"The block's revision does not match the state; it cannot be accepted."}
	}
	if problems == nil {
		problems = []string{}
	}
	return map[string]any{
		"state_id": stateID.String(),
		"valid":    len(problems) == 0,
		"problems": problems,
	}
}
