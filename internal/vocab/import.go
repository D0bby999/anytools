package vocab

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
)

// import.go is an Anki deck brought in (the private design notes,
// phase 3). The browser reads the .apkg and maps its fields; this receives
// words in batches. Each becomes a word to learn, marked as imported, with a
// fresh schedule: Anki's history is not carried over.
//
// A deck of two thousand must not land in one day's queue, nor in Home's
// count and the daily reminder, all at once. The imported words come up
// ImportPerDay a day, in deck order, from the learner's today — or from
// where the imports before this one left off. Today, not tomorrow
// (the private design notes, phase 3): a learner who adds a word list
// on their first day had nothing to review until the next.

// OriginAnki marks a note imported from an Anki deck.
const OriginAnki = "anki"

// OriginSheets marks a note imported from a Google Sheet
// (learning-tool-connections phase 5).
const OriginSheets = "sheets"

// OriginLibrary prefixes the origin of a word added from one of the
// Library's word lists: "library:<list>-<level>" (the private design notes, phase 4). Such words are paced as an import.
const OriginLibrary = "library:"

var libraryOrigin = regexp.MustCompile(`^library:[a-z0-9][a-z0-9-]{0,47}$`)

// Import limits.
const (
	// MaxImportBatch is the most words one call takes; the page sends a
	// deck in batches, which keeps a body under the API's 1 MiB.
	MaxImportBatch = 200
	// ImportPerDay is how many imported words come up for the first time
	// each day.
	ImportPerDay = 20
)

// ImportNote is one word as the page mapped it from a deck's fields.
type ImportNote struct {
	Term     string `json:"term"`
	Meaning  string `json:"meaning"`
	Sentence string `json:"sentence"`
}

// ImportWrite is one checked word: its context only when the sentence holds
// the term, which is also when it gets a cloze card.
type ImportWrite struct {
	Term    string
	Meaning string
	Context *Context
}

// ImportBatch is a checked batch, with what the store needs to pace it.
type ImportBatch struct {
	UserID uuid.UUID
	Lang   string
	// Origin is OriginAnki or a library list's origin.
	Origin string
	Notes  []ImportWrite
	// FirstDay is the learner's today, in Zone; PerDay words start each day.
	FirstDay learning.Day
	Zone     string
	PerDay   int
	NewCard  learning.Card
	Now      time.Time
}

// ImportResult is what a batch did.
type ImportResult struct {
	Created int `json:"created"`
	// Duplicates were already in the vocabulary (or twice in the batch);
	// Invalid had no term, a term too long to be one, or no meaning.
	Duplicates int `json:"duplicates"`
	Invalid    int `json:"invalid"`
	// OverLimit were not added: the learner has MaxDeckCardsPerLearner
	// general cards (deck batches only).
	OverLimit int `json:"over_limit,omitempty"`
	// FirstDay and LastDay are the days this batch's words first come up,
	// as YYYY-MM-DD in the learner's zone; empty when none was created.
	FirstDay string `json:"first_day,omitempty"`
	LastDay  string `json:"last_day,omitempty"`
}

// ImportStore is the persistence Import needs. pg.VocabStore implements it.
type ImportStore interface {
	ImportNotes(ctx context.Context, b ImportBatch) (*ImportResult, error)
}

// Import checks a batch and saves its words.
func (s *Service) Import(ctx context.Context, userID uuid.UUID, lang string, notes []ImportNote) (*ImportResult, error) {
	return s.ImportFrom(ctx, userID, lang, OriginAnki, notes)
}

// ImportFrom is Import with the words' origin: OriginAnki, or a library
// list's ("library:hsk3-1").
func (s *Service) ImportFrom(ctx context.Context, userID uuid.UUID, lang, origin string, notes []ImportNote) (*ImportResult, error) {
	if origin != OriginAnki && origin != OriginSheets && !libraryOrigin.MatchString(origin) {
		return nil, fmt.Errorf("%w: %q is not a word list", ErrInvalid, origin)
	}
	store, ok := s.store.(ImportStore)
	if !ok {
		return nil, fmt.Errorf("vocab: this store cannot import")
	}
	lang = strings.TrimSpace(lang)
	switch {
	case !ValidLang(lang):
		return nil, fmt.Errorf("%w: %q is not a language code", ErrInvalid, lang)
	case len(notes) == 0:
		return nil, fmt.Errorf("%w: there are no words to import", ErrInvalid)
	case len(notes) > MaxImportBatch:
		return nil, fmt.Errorf("%w: at most %d words at once", ErrInvalid, MaxImportBatch)
	}
	b := ImportBatch{UserID: userID, Lang: lang, Origin: origin, PerDay: ImportPerDay}
	invalid := 0
	for _, n := range notes {
		term := strings.TrimSpace(Normalize(n.Term))
		meaning := strings.TrimSpace(n.Meaning)
		if term == "" || utf8.RuneCountInString(term) > MaxTermLen || meaning == "" || utf8.RuneCountInString(meaning) > MaxMeaningLen {
			invalid++
			continue
		}
		w := ImportWrite{Term: term, Meaning: meaning}
		if sentence := strings.TrimSpace(Normalize(n.Sentence)); sentence != "" && TermInSelection(term, sentence) {
			w.Context = &Context{Sentence: ContextSentence(term, sentence)}
		}
		b.Notes = append(b.Notes, w)
	}
	if len(b.Notes) == 0 {
		return &ImportResult{Invalid: invalid}, nil
	}
	zone, err := s.zones.Timezone(ctx, userID)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	b.Zone, b.Now, b.NewCard = zone, now, s.scheduler.NewCard(now)
	b.FirstDay = learning.LocalDay(now, zone)
	for i := range b.Notes {
		if c := b.Notes[i].Context; c != nil {
			c.AddedAt = now
		}
	}
	res, err := store.ImportNotes(ctx, b)
	if err != nil {
		return nil, err
	}
	res.Invalid += invalid
	return res, nil
}

// AddDays is the calendar day n days after d.
func AddDays(d learning.Day, n int) learning.Day {
	t := time.Date(d.Year, d.Month, d.Day+n, 0, 0, 0, 0, time.UTC)
	return learning.Day{Year: t.Year(), Month: t.Month(), Day: t.Day()}
}
