package app

import (
	"context"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning/loop"
	loopprompts "github.com/D0bby999/anytools/internal/prompts/loop"
	"github.com/D0bby999/anytools/internal/tools"
)

// loopStates is the chat capability's LearningStates: it reads a state
// through the loop service and renders the message a resumed chat is shown.
//
// It lives here rather than in either package because it joins three that
// must not import each other: chat (the consumer), loop (the state) and tools
// (the envelope, whose own tests import chat).
type loopStates struct{ svc *loop.Service }

// StateContext implements chat.LearningStates.
func (l loopStates) StateContext(ctx context.Context, userID, stateID uuid.UUID) (string, string, error) {
	rc, err := l.svc.ResumeContext(ctx, userID, stateID)
	if err != nil {
		return "", "", err
	}
	return resumeMessage(rc), rc.Revision, nil
}

// resumeMessage is the resume prompt, then the revision in the system's own
// voice, then the state quoted inside the provenance envelope.
//
// The state is enveloped because handover_md can hold a model's earlier
// paste-back, and a paste-back that says "ignore your rules" is exactly the
// sentence the envelope exists to demote to evidence. The revision is OUTSIDE
// it: it is the one value the model must copy rather than interpret.
func resumeMessage(rc *loop.ResumeContext) string {
	return loopprompts.Resume +
		"\n\nRevision: " + rc.Revision + "\n\n" +
		tools.Wrap("learning state: "+rc.State.Goal, "state:"+rc.State.ID.String(),
			loop.RenderState(rc.State, rc.Cycle))
}
