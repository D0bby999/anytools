package quiz

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	quizprompts "github.com/D0bby999/anytools/internal/prompts/quiz"
	"github.com/D0bby999/anytools/internal/runtime"
)

// ideate.go is the first of the two generation calls: deciding WHAT is worth
// asking before writing anything.
//
// Two calls rather than one is DeepTutor's `ask_questions` shape, and the
// reason survives the port: a single "write me five questions about this"
// prompt produces five questions about whatever the first passage happened to
// be, because the model commits to its first idea and then fills the quota. A
// planning pass that must name a focus and a passage per question, and is
// allowed to return fewer than asked, makes "there are only three distinct
// ideas in this material" an outcome the model can express.

// Idea is one planned question.
type Idea struct {
	Focus      string   `json:"focus"`
	Type       string   `json:"type"`
	Difficulty string   `json:"difficulty"`
	ChunkIDs   []string `json:"chunk_ids"`
}

type ideationReply struct {
	Ideas []Idea `json:"ideas"`
	Note  string `json:"note"`
}

// ideate asks the model to plan n questions over the retrieved passages.
func (s *Service) ideate(
	ctx context.Context, provider runtime.ChatProvider, model string,
	chunks []Chunk, n int, types []string, topic string,
) ([]Idea, string, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "Plan at most %d questions.\n", n)
	fmt.Fprintf(&b, "Allowed question types: %s.\n", strings.Join(types, ", "))
	if topic != "" {
		fmt.Fprintf(&b, "The learner asked about: %s\n", topic)
	}
	b.WriteString("\nPassages:\n\n")
	b.WriteString(passageBlock(chunks))

	var reply ideationReply
	if err := askJSON(ctx, provider, model, quizprompts.Ideate, b.String(), &reply); err != nil {
		return nil, "", err
	}

	known := chunkIndex(chunks)
	out := make([]Idea, 0, len(reply.Ideas))
	allowed := make(map[string]bool, len(types))
	for _, t := range types {
		allowed[t] = true
	}

	for _, idea := range reply.Ideas {
		if len(out) >= n {
			break
		}
		idea.Type = strings.ToLower(strings.TrimSpace(idea.Type))
		if !allowed[idea.Type] {
			// A model that ignored the allowed types gets its idea rewritten
			// to the first one the caller permitted rather than dropped: the
			// FOCUS is the valuable part of an idea, and the type is a
			// presentation choice the product is entitled to make.
			idea.Type = types[0]
		}
		idea.Difficulty = normalizeDifficulty(idea.Difficulty)

		// Keep only chunk ids that were actually in the passages. An idea
		// anchored to an id the model invented is an idea anchored to nothing,
		// and the generation call would then have no passage to write from.
		kept := make([]string, 0, len(idea.ChunkIDs))
		for _, id := range idea.ChunkIDs {
			id = strings.TrimPrefix(strings.TrimSpace(id), "chunk:")
			if _, ok := known[id]; ok {
				kept = append(kept, id)
			}
		}
		if len(kept) == 0 {
			continue
		}
		idea.ChunkIDs = kept

		if strings.TrimSpace(idea.Focus) == "" {
			continue
		}
		out = append(out, idea)
	}
	return out, reply.Note, nil
}

func normalizeDifficulty(d string) string {
	switch strings.ToLower(strings.TrimSpace(d)) {
	case DifficultyEasy:
		return DifficultyEasy
	case DifficultyHard:
		return DifficultyHard
	default:
		return DifficultyMedium
	}
}

// parseChunkIDs turns validated string ids into uuids, dropping anything that
// does not parse. It is used by generation to record `source_chunk_ids`.
func parseChunkIDs(ids []string, known map[string]Chunk) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		id = strings.TrimPrefix(strings.TrimSpace(id), "chunk:")
		if seen[id] {
			continue
		}
		if _, ok := known[id]; !ok {
			continue
		}
		parsed, err := uuid.Parse(id)
		if err != nil {
			continue
		}
		seen[id] = true
		out = append(out, parsed)
	}
	return out
}
