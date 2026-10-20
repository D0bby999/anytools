package vocab

// languages.go is the languages a learner studies
// (plans/261020-1535-beyond-english-learning-areas, phase 1): the tabs of the
// Languages page, in the learner's order, and the one viewed last. A word's
// language stays its own (Note.Lang, detected from its page); this list only
// says which tabs to show, so dropping a language keeps its words.

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// MaxStudied caps the studied languages, as the table's CHECK does.
const MaxStudied = 20

// Studied is the learner's list and the tab they viewed last ("" for none).
type Studied struct {
	Languages []string `json:"studied"`
	Current   string   `json:"current"`
}

// LangCount is one language of the learner's saved words: how many words,
// and how many of their cards are due today.
type LangCount struct {
	Lang  string `json:"lang"`
	Words int    `json:"words"`
	Due   int    `json:"due"`
}

// Languages is GET /v1/vocab/languages: the list, and every language the
// learner has words in, for the picker's suggestions and the tabs' counts.
type Languages struct {
	Studied
	Saved []LangCount `json:"saved"`
}

// LanguageStore is the persistence the list needs. pg.VocabStore implements it.
type LanguageStore interface {
	StudiedLanguages(ctx context.Context, userID uuid.UUID) (Studied, error)
	SetStudiedLanguages(ctx context.Context, userID uuid.UUID, s Studied) error
	// SavedLanguages counts the words per language and their cards due
	// before `before`.
	SavedLanguages(ctx context.Context, userID uuid.UUID, before time.Time) ([]LangCount, error)
}

func (s *Service) languageStore() (LanguageStore, error) {
	store, ok := s.store.(LanguageStore)
	if !ok {
		return nil, fmt.Errorf("vocab: this store keeps no studied languages")
	}
	return store, nil
}

// Languages returns the learner's list and their words' languages.
func (s *Service) Languages(ctx context.Context, userID uuid.UUID) (*Languages, error) {
	store, err := s.languageStore()
	if err != nil {
		return nil, err
	}
	studied, err := store.StudiedLanguages(ctx, userID)
	if err != nil {
		return nil, err
	}
	before, err := s.tomorrow(ctx, userID, s.now().UTC())
	if err != nil {
		return nil, err
	}
	saved, err := store.SavedLanguages(ctx, userID, before)
	if err != nil {
		return nil, err
	}
	return &Languages{Studied: studied, Saved: saved}, nil
}

// SetLanguages replaces the list. Codes are checked like a word's language
// and kept in the learner's order without repeats; the current one must be
// on the list, and is the first when it is not given.
func (s *Service) SetLanguages(ctx context.Context, userID uuid.UUID, in Studied) (*Studied, error) {
	store, err := s.languageStore()
	if err != nil {
		return nil, err
	}
	out, err := CleanStudied(in)
	if err != nil {
		return nil, err
	}
	if err := store.SetStudiedLanguages(ctx, userID, out); err != nil {
		return nil, err
	}
	return &out, nil
}

// CleanStudied checks and normalises a list.
func CleanStudied(in Studied) (Studied, error) {
	out := Studied{Languages: []string{}}
	seen := map[string]bool{}
	for _, l := range in.Languages {
		l = strings.TrimSpace(l)
		if !ValidLang(l) {
			return Studied{}, fmt.Errorf("%w: %q is not a language code", ErrInvalid, l)
		}
		if !seen[l] {
			seen[l] = true
			out.Languages = append(out.Languages, l)
		}
	}
	if len(out.Languages) > MaxStudied {
		return Studied{}, fmt.Errorf("%w: at most %d languages", ErrInvalid, MaxStudied)
	}
	out.Current = strings.TrimSpace(in.Current)
	switch {
	case out.Current == "" && len(out.Languages) > 0:
		out.Current = out.Languages[0]
	case out.Current != "" && !seen[out.Current]:
		return Studied{}, fmt.Errorf("%w: the current language must be one of the studied ones", ErrInvalid)
	}
	return out, nil
}
