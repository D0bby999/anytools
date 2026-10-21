package chat

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning/ownversion"
	"github.com/D0bby999/anytools/internal/runtime"
)

// history.go decides which earlier messages a turn sends, and summarises the
// ones that no longer fit.
//
// It replaced a cap of 40 messages. A count is the wrong unit twice over: 40
// short messages waste a large window, and 40 long ones overflow a small model,
// which then either refuses the request or (Ollama) silently drops the start of
// the prompt, system rules included.

// historyFetch is how many messages a turn reads. The budget decides how many
// it sends; this only bounds the read.
const historyFetch = 200

// SummaryWriter stores a conversation's rolling summary. The pg ChatStore
// implements it; a store that does not simply trims without summarising.
type SummaryWriter interface {
	SetSummary(ctx context.Context, userID, sessionID uuid.UUID, summary string, through uuid.UUID) error
}

// summaryMaxChars caps a stored summary. A summary that grows without bound
// is just the history again, paid for twice.
const summaryMaxChars = 6000

// splitHistory returns the earlier messages a turn may send, oldest first,
// without the current question: the ones after the summary, newest kept
// first, within budget tokens.
//
// overflow is everything after the summary that did not fit, oldest first.
// When there is any, kept is cut back to compactTarget of the budget so the
// summary call is not repeated on the very next turn.
func splitHistory(
	history []runtime.ChatMessage, summaryThrough *uuid.UUID, inputID uuid.UUID, budget int,
) (kept, overflow []runtime.ChatMessage) {
	start := 0
	if summaryThrough != nil {
		for i, m := range history {
			if m.ID == *summaryThrough {
				start = i + 1
				break
			}
		}
	}
	prior := make([]runtime.ChatMessage, 0, len(history)-start)
	for _, m := range history[start:] {
		if inputID != uuid.Nil && m.ID == inputID {
			continue
		}
		if m.Role != runtime.RoleUser && m.Role != runtime.RoleAssistant {
			continue
		}
		if strings.TrimSpace(m.Content) == "" {
			continue
		}
		prior = append(prior, m)
	}

	cut := fitFrom(prior, budget)
	if cut == 0 {
		return prior, nil
	}
	cut = fitFrom(prior, int(float64(budget)*compactTarget))
	// Never open the kept part on an answer whose question is gone: the model
	// reads an orphan answer as something it said unprompted.
	for cut < len(prior) && prior[cut].Role == runtime.RoleAssistant {
		cut++
	}
	return prior[cut:], prior[:cut]
}

// fitFrom returns the first index whose suffix fits in budget tokens.
func fitFrom(msgs []runtime.ChatMessage, budget int) int {
	used := 0
	for i := len(msgs) - 1; i >= 0; i-- {
		used += estimateTokens(messageText(msgs[i])) + 4
		if used > budget {
			return i + 1
		}
	}
	return 0
}

// messageText is what a stored message reads as to the model: a question
// carries the learner's own attempt when it had one.
func messageText(m runtime.ChatMessage) string {
	if m.Role == runtime.RoleUser {
		return ownversion.WithQuestion(m.Content, ownversion.FromAttachments(m.Attachments))
	}
	return m.Content
}

// summarize folds overflow into the session's summary with the learner's own
// chat route, stores it, and returns it. On any failure it returns the old
// summary and false: the turn goes on with a shorter history rather than
// failing over bookkeeping.
func (c *Capability) summarize(
	ctx context.Context, tc *runtime.TurnContext, provider runtime.ChatProvider, model, previous string,
	overflow []runtime.ChatMessage,
) (string, bool) {
	writer, ok := c.messages.(SummaryWriter)
	if !ok || len(overflow) == 0 {
		return previous, false
	}

	var b strings.Builder
	if previous != "" {
		b.WriteString("Previous summary:\n")
		b.WriteString(previous)
		b.WriteString("\n\n")
	}
	b.WriteString("Messages to fold in, oldest first:\n")
	for _, m := range overflow {
		fmt.Fprintf(&b, "\n[%s]\n%s\n", m.Role, truncate(messageText(m), 4000))
	}

	ask := func(msgs []runtime.Message) (*runtime.ChatResponse, error) {
		resp, err := provider.Chat(ctx, runtime.ChatRequest{Model: model, Messages: msgs, Options: map[string]any{"max_tokens": 900}})
		if err == nil && resp != nil {
			tc.AddUsage(resp.Usage)
		}
		return resp, err
	}
	msgs := []runtime.Message{
		{Role: runtime.RoleSystem, Content: summarizerPrompt},
		{Role: runtime.RoleUser, Content: b.String()},
	}
	resp, err := ask(msgs)
	if err != nil || resp == nil {
		slog.Warn("chat: summarise earlier messages", "error", err, "session", tc.Session.ID)
		return previous, false
	}
	summary, reason := checkSummary(resp)
	// A summary that left out a part is asked for once more, with what it
	// wrote, rather than accepted with a hole or thrown away.
	if reason == "" && len(missingLabels(summary)) > 0 {
		retry := append(msgs,
			runtime.Message{Role: runtime.RoleAssistant, Content: resp.Content},
			runtime.Message{Role: runtime.RoleUser, Content: repairNote(missingLabels(summary))})
		if again, err := ask(retry); err == nil && again != nil {
			if fixed, why := checkSummary(again); why == "" && len(missingLabels(fixed)) < len(missingLabels(summary)) {
				summary = fixed
			}
		}
	}
	if reason != "" {
		// A cut or empty summary never replaces the one there is: it would
		// lose what the earlier summary held (postclaw's C4).
		slog.Warn("chat: summary rejected", "reason", reason, "session", tc.Session.ID)
		return previous, false
	}
	summary = truncate(completeSummary(summary, overflow), summaryMaxChars)

	through := overflow[len(overflow)-1].ID
	if err := writer.SetSummary(ctx, tc.Turn.UserID, tc.Session.ID, summary, through); err != nil {
		slog.Warn("chat: store summary", "error", err, "session", tc.Session.ID)
		return previous, false
	}
	return summary, true
}

// summaryNote is the system message that stands in for the summarised part.
func summaryNote(summary string) string {
	return "Summary of the earlier part of this conversation. The messages it covers are no longer shown to you; " +
		"treat it as your memory of them, not as a source to cite:\n\n" + summary
}
