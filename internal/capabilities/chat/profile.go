package chat

import (
	"context"
	"log/slog"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/runtime"
)

// profile.go is the learner profile's one pull point in chat (learning-depth
// phase 9): the learner's Preferences, and only when they have some.
//
// Never Studying: a session linked to a learning state already gets its goal
// from the state (state_context.go), and a second statement of it is how a
// model ends up hedging between two goals. Only accepted entries are read,
// and they arrive quoted inside the provenance envelope, rendered by
// internal/learning/profile through the wiring — this package does not import
// the envelope, for the reason state_context.go gives.

// LearnerProfile renders the learner's chat preferences for one turn: a
// system message, or "" when there are none.
type LearnerProfile interface {
	ChatNote(ctx context.Context, userID uuid.UUID, kbIDs []uuid.UUID) (string, error)
}

// WithProfile enables the preferences note. Without it, chat reads no profile.
func (c *Capability) WithProfile(p LearnerProfile) *Capability {
	c.profile = p
	return c
}

// profileNote is the preferences message for this turn, or "". A profile that
// cannot be read costs the turn its preferences, not the answer.
func (c *Capability) profileNote(ctx context.Context, tc *runtime.TurnContext) string {
	if c.profile == nil {
		return ""
	}
	note, err := c.profile.ChatNote(ctx, tc.Turn.UserID, tc.Session.KBIDs)
	if err != nil {
		slog.Warn("chat: learner profile unavailable for this turn", "user", tc.Turn.UserID, "error", err)
		return ""
	}
	return note
}
