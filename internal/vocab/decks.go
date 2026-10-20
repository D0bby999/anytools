package vocab

// decks.go is the learner's general decks (plans/261020-1535-beyond-english-
// learning-areas, phase 5; owner decision 5): a deck that is not vocabulary,
// from the library or an Anki file. Its cards are a front and a back with no
// note (KindCard), reviewed in their own queue (DeckCards) and counted with
// the rest in Home's total and the reminder. Like an imported vocabulary deck
// they come up ImportPerDay a day, from the learner's tomorrow or from where
// earlier deck imports left off, so a deck of six hundred is a month of new
// cards, not one evening.

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
)

// KindCard is a general deck's card: its own front and back, no note.
const KindCard = "card"

// DeckCards is the general decks' queue, beside DeckWords and DeckBook.
const DeckCards = "cards"

// Deck limits, as the tables check them.
const (
	MaxDeckName  = 200
	MaxDeckFront = 500
	MaxDeckBack  = 2000
)

// Deck is one of the learner's general decks, with its counts.
type Deck struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Source    string    `json:"source"`
	Licence   string    `json:"licence"`
	SourceURL string    `json:"source_url"`
	CreatedAt time.Time `json:"created_at"`
	// Cards in all; Due today; New not yet seen, the last of them first
	// coming up on LastNew (YYYY-MM-DD in the learner's zone).
	Cards   int    `json:"cards"`
	Due     int    `json:"due"`
	New     int    `json:"new"`
	LastNew string `json:"last_new,omitempty"`
}

// NewDeck is POST /v1/decks.
type NewDeck struct {
	Name      string `json:"name"`
	Source    string `json:"source"`
	Licence   string `json:"licence"`
	SourceURL string `json:"source_url"`
}

// DeckCard is one card as the page mapped it.
type DeckCard struct {
	Front string `json:"front"`
	Back  string `json:"back"`
}

// DeckBatch is a checked batch of cards, with what the store needs to pace it.
type DeckBatch struct {
	UserID   uuid.UUID
	DeckID   uuid.UUID
	Cards    []DeckCard
	FirstDay learning.Day
	Zone     string
	PerDay   int
	NewCard  learning.Card
	Now      time.Time
}

// DeckStore is the persistence decks need. pg.VocabStore implements it.
type DeckStore interface {
	CreateDeck(ctx context.Context, userID uuid.UUID, d NewDeck) (*Deck, error)
	// ListDecks counts each deck's cards due before `before`; zone renders
	// LastNew.
	ListDecks(ctx context.Context, userID uuid.UUID, before time.Time, zone string) ([]Deck, error)
	DeleteDeck(ctx context.Context, userID, id uuid.UUID) error
	// AddDeckCards inserts the batch, a card whose front the deck already
	// has counted as a duplicate; ErrNotFound for a deck not the user's.
	AddDeckCards(ctx context.Context, b DeckBatch) (*ImportResult, error)
}

func (s *Service) deckStore() (DeckStore, error) {
	store, ok := s.store.(DeckStore)
	if !ok {
		return nil, fmt.Errorf("vocab: this store keeps no decks")
	}
	return store, nil
}

// CreateDeck checks and creates a deck.
func (s *Service) CreateDeck(ctx context.Context, userID uuid.UUID, d NewDeck) (*Deck, error) {
	store, err := s.deckStore()
	if err != nil {
		return nil, err
	}
	d.Name = strings.TrimSpace(d.Name)
	d.Source, d.Licence, d.SourceURL = strings.TrimSpace(d.Source), strings.TrimSpace(d.Licence), strings.TrimSpace(d.SourceURL)
	switch {
	case d.Name == "" || utf8.RuneCountInString(d.Name) > MaxDeckName:
		return nil, fmt.Errorf("%w: a deck needs a name of at most %d characters", ErrInvalid, MaxDeckName)
	case utf8.RuneCountInString(d.Source) > 500, utf8.RuneCountInString(d.Licence) > 200, utf8.RuneCountInString(d.SourceURL) > 500:
		return nil, fmt.Errorf("%w: the deck's source or licence is too long", ErrInvalid)
	case d.SourceURL != "" && !strings.HasPrefix(d.SourceURL, "https://"):
		return nil, fmt.Errorf("%w: a deck's link starts with https://", ErrInvalid)
	}
	return store.CreateDeck(ctx, userID, d)
}

// Decks lists the learner's decks, newest first, with their counts.
func (s *Service) Decks(ctx context.Context, userID uuid.UUID) ([]Deck, error) {
	store, err := s.deckStore()
	if err != nil {
		return nil, err
	}
	zone, err := s.zones.Timezone(ctx, userID)
	if err != nil {
		return nil, err
	}
	before, err := s.tomorrow(ctx, userID, s.now().UTC())
	if err != nil {
		return nil, err
	}
	return store.ListDecks(ctx, userID, before, zone)
}

// DeleteDeck deletes a deck and its cards.
func (s *Service) DeleteDeck(ctx context.Context, userID, id uuid.UUID) error {
	store, err := s.deckStore()
	if err != nil {
		return err
	}
	return store.DeleteDeck(ctx, userID, id)
}

// AddDeckCards checks a batch and adds it to the deck, paced.
func (s *Service) AddDeckCards(ctx context.Context, userID, deckID uuid.UUID, cards []DeckCard) (*ImportResult, error) {
	store, err := s.deckStore()
	if err != nil {
		return nil, err
	}
	switch {
	case len(cards) == 0:
		return nil, fmt.Errorf("%w: no cards to add", ErrInvalid)
	case len(cards) > MaxImportBatch:
		return nil, fmt.Errorf("%w: at most %d cards a call", ErrInvalid, MaxImportBatch)
	}
	b := DeckBatch{UserID: userID, DeckID: deckID, PerDay: ImportPerDay}
	invalid := 0
	seen := map[string]bool{}
	for _, c := range cards {
		front, back := strings.TrimSpace(c.Front), strings.TrimSpace(c.Back)
		if front == "" || back == "" || utf8.RuneCountInString(front) > MaxDeckFront || utf8.RuneCountInString(back) > MaxDeckBack {
			invalid++
			continue
		}
		if seen[front] {
			continue // twice in one batch: the store counts the first one's duplicate
		}
		seen[front] = true
		b.Cards = append(b.Cards, DeckCard{Front: front, Back: back})
	}
	dupes := len(cards) - invalid - len(b.Cards)
	if len(b.Cards) == 0 {
		return &ImportResult{Invalid: invalid, Duplicates: dupes}, nil
	}
	zone, err := s.zones.Timezone(ctx, userID)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	b.Zone, b.Now, b.NewCard = zone, now, s.scheduler.NewCard(now)
	b.FirstDay = AddDays(learning.LocalDay(now, zone), 1)
	res, err := store.AddDeckCards(ctx, b)
	if err != nil {
		return nil, err
	}
	res.Invalid += invalid
	res.Duplicates += dupes
	return res, nil
}
