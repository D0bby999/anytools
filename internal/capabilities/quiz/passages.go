package quiz

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// passages.go is question writing for a caller that has already chosen the
// material: a living book's quiz block (learning-depth phase 11) is written
// from its chapter's passages, not from a fresh search, so its questions test
// what the chapter teaches. It is ONE call on the learner's `quiz` route —
// the chapter plan already decided what the block is about, which is the job
// ideation does for Generate — and every question passes the same validation
// and lands in the same bank, so it shows up in practice and as evidence like
// any other.

// MaxFromPassages caps one such call; a book's quiz block asks 1–3.
const MaxFromPassages = 3

// GenerateFromPassages writes up to n questions about focus from chunks and
// stores those that survive validation under kbID. The caller vouches that
// the chunks are the user's and in that knowledge base; the knowledge base is
// still checked here, so a foreign kbID is ErrNoAccess.
func (s *Service) GenerateFromPassages(
	ctx context.Context, userID, kbID uuid.UUID, chunks []Chunk, n int, focus string,
) (*GenerateResult, error) {
	if err := s.authz.OwnsKB(ctx, userID, kbID); err != nil {
		return nil, ErrNoAccess
	}
	if n < 1 {
		n = 1
	}
	if n > MaxFromPassages {
		n = MaxFromPassages
	}
	if len(chunks) == 0 {
		return nil, ErrNoQuestions
	}
	focus = strings.TrimSpace(focus)
	if focus == "" {
		focus = "the key ideas of these passages"
	}

	provider, err := s.providers.ChatFor(ctx, userID, functionQuiz)
	if err != nil {
		return nil, err
	}
	model := provider.DefaultModel()

	ids := make([]string, 0, len(chunks))
	for _, c := range chunks {
		ids = append(ids, c.ID.String())
	}
	// Objective types first: a chapter's check-in should be answerable in a
	// click, and the judge then needs no model call either.
	types := []string{TypeMCQ, TypeTF}
	ideas := make([]Idea, 0, n)
	for i := 0; i < n; i++ {
		ideas = append(ideas, Idea{
			Focus: fmt.Sprintf("%s (question %d of %d, each on a different point)", focus, i+1, n),
			Type:  types[i%len(types)], Difficulty: DifficultyMedium, ChunkIDs: ids,
		})
	}

	drafted, note, dropped, err := s.generate(ctx, provider, model, chunks, ideas, types)
	if err != nil {
		return nil, err
	}
	if len(drafted) > n {
		drafted = drafted[:n]
	}
	if len(drafted) == 0 {
		return nil, ErrNoQuestions
	}
	for i := range drafted {
		drafted[i].UserID = userID
		drafted[i].KBID = kbID
	}
	stored, err := s.store.InsertQuestions(ctx, drafted)
	if err != nil {
		return nil, fmt.Errorf("quiz: store questions: %w", err)
	}
	return &GenerateResult{
		Questions: stored, Requested: n, DroppedCitations: dropped,
		Model: model, Provider: provider.Name(), Note: note,
	}, nil
}
