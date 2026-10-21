package vocab

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

// sentence.go is a sentence taken from an open source for a word that has
// none, or another (the private design notes, phase 6): it
// becomes the word's newest context, credited, and a word being learned gets
// its cloze card from it.

// MaxCreditLen caps a sentence's credit ("Tatoeba, CK, CC BY 2.0 FR");
// MaxSentenceLen the sentence, one to read on a card.
const (
	MaxCreditLen   = 300
	MaxSentenceLen = 500
)

// AddSentence adds sentence to the learner's note id, crediting it. The
// sentence must hold the word, as a cloze card needs it to.
func (s *Service) AddSentence(ctx context.Context, userID, id uuid.UUID, sentence, credit, link string) (*Note, error) {
	store, ok := s.store.(SentenceStore)
	if !ok {
		return nil, fmt.Errorf("vocab: this store cannot add sentences")
	}
	sentence = strings.TrimSpace(Normalize(sentence))
	credit = strings.TrimSpace(credit)
	link = strings.TrimSpace(link)
	switch {
	case sentence == "" || utf8.RuneCountInString(sentence) > MaxSentenceLen:
		return nil, fmt.Errorf("%w: a sentence is 1 to %d characters", ErrInvalid, MaxSentenceLen)
	case credit == "" || utf8.RuneCountInString(credit) > MaxCreditLen:
		return nil, fmt.Errorf("%w: a sentence from a source says whose it is, in at most %d characters", ErrInvalid, MaxCreditLen)
	}
	if link != "" {
		if u, err := url.Parse(link); err != nil || u.Scheme != "https" || u.Host == "" || len(link) > 500 {
			return nil, fmt.Errorf("%w: the sentence's link is an https address", ErrInvalid)
		}
	}
	note, err := s.store.GetNote(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if !TermInSelection(note.Term, sentence) {
		return nil, fmt.Errorf("%w: the sentence does not hold the word", ErrInvalid)
	}
	now := s.now().UTC()
	c := Context{Sentence: ContextSentence(note.Term, sentence), AddedAt: now, Credit: credit, URL: link}
	return store.AddSentence(ctx, userID, id, c, s.scheduler.NewCard(now), now)
}
