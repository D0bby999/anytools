package quiz

import (
	"context"
	"fmt"
	"sync"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/quiz/starters"
)

// StarterPython names the Python starter set.
const StarterPython = "python"

// StarterResult is what adding a set did.
type StarterResult struct {
	Added   int `json:"added"`
	Already int `json:"already"`
}

// AddStarter adds a starter set's exercises to one of the learner's
// knowledge bases as code questions, each once: an exercise whose module the
// knowledge base already has a code question for is not added again. No
// model is called.
// starterMu: the check for exercises already added and the insert are one
// step, so a double click adds the set once (the API is one process).
var starterMu sync.Mutex

func (s *Service) AddStarter(ctx context.Context, userID, kbID uuid.UUID, set string) (*StarterResult, error) {
	starterMu.Lock()
	defer starterMu.Unlock()
	if set != StarterPython {
		return nil, fmt.Errorf("%w: unknown starter set %q", ErrBadRequest, set)
	}
	if err := s.authz.OwnsKB(ctx, userID, kbID); err != nil {
		return nil, ErrNoAccess
	}
	existing, err := s.store.ListQuestions(ctx, userID, Filter{KBID: &kbID, Type: TypeCode, Limit: 500})
	if err != nil {
		return nil, err
	}
	have := map[string]bool{}
	for _, e := range existing {
		if e.Question.Code != nil {
			have[e.Question.Code.Module] = true
		}
	}
	res := &StarterResult{}
	var qs []Question
	for _, ex := range starters.Python() {
		if have[ex.Module] {
			res.Already++
			continue
		}
		code, err := CleanCode(CodeExercise{Module: ex.Module, Starter: ex.Starter, Tests: ex.Tests, Credit: ex.Credit}, ex.Solution)
		if err != nil {
			return nil, fmt.Errorf("starter %s: %w", ex.Slug, err)
		}
		qs = append(qs, Question{
			UserID: userID, KBID: kbID, Type: TypeCode, Difficulty: DifficultyEasy,
			Prompt:      "## " + ex.Title + "\n\n" + ex.Instructions,
			Answer:      ex.Solution,
			Explanation: ex.Credit,
			Code:        &code,
		})
	}
	if len(qs) > 0 {
		stored, err := s.store.InsertQuestions(ctx, qs)
		if err != nil {
			return nil, err
		}
		res.Added = len(stored)
	}
	return res, nil
}
