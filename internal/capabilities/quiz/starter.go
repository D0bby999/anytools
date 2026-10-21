package quiz

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/quiz/starters"
)

// StarterPython names the Python starter set.
const StarterPython = starters.SetPython

// StarterResult is what adding a set did.
type StarterResult struct {
	Added   int `json:"added"`
	Already int `json:"already"`
}

// SetStore is the store's check for questions a knowledge base already has,
// by prompt, and code questions by module. The pg store implements it; the
// Store interface does not grow for one caller.
type SetStore interface {
	ExistingQuestions(ctx context.Context, userID, kbID uuid.UUID, prompts, modules []string) (map[string]bool, error)
}

// setLocks: the check for questions already added and the insert are one
// step per knowledge base, so a double click adds a part once (the API is
// one process) and one learner's add does not wait on another's.
var (
	setLocksMu sync.Mutex
	setLocks   = map[uuid.UUID]*setLock{}
)

type setLock struct {
	sync.Mutex
	users int
}

func lockKB(kb uuid.UUID) func() {
	setLocksMu.Lock()
	l := setLocks[kb]
	if l == nil {
		l = &setLock{}
		setLocks[kb] = l
	}
	l.users++
	setLocksMu.Unlock()
	l.Lock()
	return func() {
		l.Unlock()
		setLocksMu.Lock()
		if l.users--; l.users == 0 {
			delete(setLocks, kb)
		}
		setLocksMu.Unlock()
	}
}

// AddStarter adds the Python set's first part: what the quiz bank's button
// has always added.
func (s *Service) AddStarter(ctx context.Context, userID, kbID uuid.UUID, set string) (*StarterResult, error) {
	return s.AddSet(ctx, userID, kbID, set, "")
}

// AddSet adds one part of a ready set (the private design notes, phase 5) to one of the learner's knowledge bases, each question
// once: one the knowledge base already has (the same prompt, or for code
// the same module) is not added again. No model is called. Each question's
// explanation ends with its set's credit.
func (s *Service) AddSet(ctx context.Context, userID, kbID uuid.UUID, set, part string) (*StarterResult, error) {
	qs, err := setQuestions(userID, kbID, set, part)
	if err != nil {
		return nil, err
	}
	return s.AddQuestions(ctx, userID, kbID, qs)
}

// AddQuestions adds ready questions to a knowledge base's bank, skipping any
// whose prompt (or code module) is already there: a Library set, or a quiz
// imported from Google Forms (learning-tool-connections phase 5). Each
// question's UserID and KBID are set here.
func (s *Service) AddQuestions(ctx context.Context, userID, kbID uuid.UUID, qs []Question) (*StarterResult, error) {
	defer lockKB(kbID)()
	for i := range qs {
		qs[i].UserID, qs[i].KBID = userID, kbID
	}
	if err := s.authz.OwnsKB(ctx, userID, kbID); err != nil {
		return nil, ErrNoAccess
	}
	store, ok := s.store.(SetStore)
	if !ok {
		return nil, fmt.Errorf("quiz: this store cannot add sets")
	}
	var prompts, modules []string
	for _, q := range qs {
		prompts = append(prompts, q.Prompt)
		if q.Code != nil {
			modules = append(modules, q.Code.Module)
		}
	}
	have, err := store.ExistingQuestions(ctx, userID, kbID, prompts, modules)
	if err != nil {
		return nil, err
	}
	res := &StarterResult{}
	var fresh []Question
	for _, q := range qs {
		if have[q.Prompt] || (q.Code != nil && have["module:"+q.Code.Module]) {
			res.Already++
			continue
		}
		fresh = append(fresh, q)
	}
	if len(fresh) > 0 {
		stored, err := s.store.InsertQuestions(ctx, fresh)
		if err != nil {
			return nil, err
		}
		res.Added = len(stored)
	}
	return res, nil
}

// setQuestions is one part of a set as questions to insert.
func setQuestions(userID, kbID uuid.UUID, set, part string) ([]Question, error) {
	if set == starters.SetPython {
		exercises, ok := starters.PythonPartOf(part)
		if !ok {
			return nil, fmt.Errorf("%w: the Python set has no part %q", ErrBadRequest, part)
		}
		var qs []Question
		for _, ex := range exercises {
			code, err := CleanCode(CodeExercise{Module: ex.Module, Starter: ex.Starter, Tests: ex.Tests, Credit: ex.Credit}, ex.Solution)
			if err != nil {
				return nil, fmt.Errorf("starter %s: %w", ex.Slug, err)
			}
			qs = append(qs, Question{
				UserID: userID, KBID: kbID, Type: TypeCode, Difficulty: exerciseDifficulty(ex.Difficulty),
				Prompt:      "## " + ex.Title + "\n\n" + ex.Instructions,
				Answer:      ex.Solution,
				Explanation: ex.Credit,
				Code:        &code,
			})
		}
		return qs, nil
	}
	s, p, ok := starters.QuestionPart(set, part)
	if !ok {
		return nil, fmt.Errorf("%w: unknown set %q or part %q", ErrBadRequest, set, part)
	}
	qs := make([]Question, 0, len(p.Questions))
	for _, q := range p.Questions {
		opts := make([]Option, len(q.Options))
		for i, o := range q.Options {
			opts[i] = Option{Label: o.Label, Body: o.Body}
		}
		qs = append(qs, Question{
			UserID: userID, KBID: kbID, Type: q.Type, Difficulty: q.Difficulty,
			Prompt: q.Prompt, Options: opts, Answer: q.Answer,
			Explanation: strings.TrimSpace(strings.TrimSpace(q.Explanation) + "\n\n" + s.Credit),
		})
	}
	return qs, nil
}

// exerciseDifficulty maps Exercism's 1 to 10 onto the quiz's three.
func exerciseDifficulty(d int) string {
	switch {
	case d <= 2:
		return DifficultyEasy
	case d <= 5:
		return DifficultyMedium
	default:
		return DifficultyHard
	}
}
