package profile

import (
	"context"
	"strings"

	"github.com/google/uuid"

	profileprompts "github.com/D0bby999/anytools/internal/prompts/profile"
	"github.com/D0bby999/anytools/internal/tools"
)

// prompt.go is how a feature reads the profile: pulled, by the few features
// that need it, and only the sections each needs (findings §8 — DeepTutor
// pulls its memory on demand for good reason).
//
//   - Mastery learn and explain-back feedback: Preferences and Struggles, for
//     the path's knowledge base.
//   - Chat: Preferences, and nothing at all when there are none. Never
//     Studying: a linked session already gets its goal from the Loop state,
//     and a second, possibly different, statement of it is how a model starts
//     hedging between two goals (red team AS-15).
//   - Book outlines (phase 11): Studying and Constraints.
//   - Research: nothing. There is no Use for it.
//
// Only accepted entries are read — the learner's own and consolidated ones
// the learner accepted. A proposal is not read until it is accepted, and a
// rejected one never is. The entries are quoted inside ONE provenance
// envelope (tools.Wrap, source "learner profile"), so neutralize defuses an
// entry that tries to close it, and the note in front says what the text is
// for and what it is not.

// Use is a feature that reads the profile.
type Use string

// The features that read the profile.
const (
	UseChat        Use = "chat"
	UseMastery     Use = "mastery"
	UseBookOutline Use = "book_outline"
)

// Sections is what a use reads, in the order the note lists them.
func (u Use) Sections() []string {
	switch u {
	case UseChat:
		return []string{SectionPreferences}
	case UseMastery:
		return []string{SectionPreferences, SectionStruggles}
	case UseBookOutline:
		return []string{SectionStudying, SectionConstraints}
	}
	return nil
}

// PromptStore reads the entries a prompt may carry.
type PromptStore interface {
	// PromptEntries returns ACCEPTED entries in sections, oldest first. An
	// entry scoped to a knowledge base is included only when kbIDs names it.
	PromptEntries(ctx context.Context, userID uuid.UUID, sections []string, kbIDs []uuid.UUID) ([]Entry, error)
}

// Prompts renders the profile for a feature's prompt.
type Prompts struct{ store PromptStore }

// NewPrompts builds the reader.
func NewPrompts(store PromptStore) *Prompts { return &Prompts{store: store} }

var sectionTitles = map[string]string{
	SectionStudying:    "Studying",
	SectionStrengths:   "Strengths",
	SectionStruggles:   "Struggles",
	SectionPreferences: "Preferences",
	SectionConstraints: "Constraints",
}

// Note is the text a feature adds to its prompt for this learner, or "" when
// the sections it reads hold nothing — in which case the feature's prompt is
// exactly what it was before this package existed.
func (p *Prompts) Note(ctx context.Context, userID uuid.UUID, use Use, kbIDs []uuid.UUID) (string, error) {
	sections := use.Sections()
	if len(sections) == 0 {
		return "", nil
	}
	entries, err := p.store.PromptEntries(ctx, userID, sections, kbIDs)
	if err != nil || len(entries) == 0 {
		return "", err
	}
	var body strings.Builder
	for _, sec := range sections {
		first := true
		for _, e := range entries {
			if e.Section != sec || e.Status != StatusAccepted {
				continue
			}
			if first {
				if body.Len() > 0 {
					body.WriteString("\n")
				}
				body.WriteString(sectionTitles[sec] + ":\n")
				first = false
			}
			body.WriteString("- " + strings.Join(strings.Fields(e.Text), " ") + "\n")
		}
	}
	if body.Len() == 0 {
		return "", nil
	}
	return strings.TrimSpace(profileprompts.Use) + "\n\n" +
		tools.Wrap("learner profile", "profile", strings.TrimSpace(body.String())), nil
}
