package chatapi

import (
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/runtime"
)

// An answer's question is the learner's message just before it; an answer
// older than the history read is not paired with a later message
// (the private design notes M5).
func TestQuestionBeforeAnAnswer(t *testing.T) {
	q1, a1, q2, a2 := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	history := []runtime.ChatMessage{
		{ID: q1, Role: runtime.RoleUser, Content: "I goed to school"},
		{ID: a1, Role: runtime.RoleAssistant, Content: "went"},
		{ID: q2, Role: runtime.RoleUser, Content: "She don't like it"},
		{ID: a2, Role: runtime.RoleAssistant, Content: "doesn't"},
	}
	if q, ok := questionBefore(history, a1); !ok || q != "I goed to school" {
		t.Errorf("a1: %q, %v", q, ok)
	}
	if q, ok := questionBefore(history, a2); !ok || q != "She don't like it" {
		t.Errorf("a2: %q, %v", q, ok)
	}
	// Out of the window read: not found, never the newest learner message.
	if q, ok := questionBefore(history[2:], a1); ok || q != "" {
		t.Errorf("an answer beyond the history: %q, %v", q, ok)
	}
	// The first message of a chat is an answer with no question before it.
	if q, ok := questionBefore(history[1:], a1); !ok || q != "" {
		t.Errorf("an answer first: %q, %v", q, ok)
	}
}
