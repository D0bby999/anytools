package vocab

// decks.go is the learner's general decks (the private design notes, phase 5; owner decision 5): a deck that is not vocabulary,
// from the library or an Anki file. Its cards are a front and a back with no
// note (KindCard), reviewed in their own queue (DeckCards) and counted with
// the rest in Home's total and the reminder. Like an imported vocabulary deck
// they come up ImportPerDay a day, from the learner's tomorrow or from where
// earlier deck imports left off, so a deck of six hundred is a month of new
// cards, not one evening.

import (
	"context"
	"errors"
	"fmt"
	"regexp"
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

// ErrLimit is a store's answer when the learner has all the decks allowed.
var ErrLimit = errors.New("vocab: limit reached")

// Deck limits, as the tables check them.
const (
	MaxDeckName  = 200
	MaxDeckFront = 500
	MaxDeckBack  = 2000
)

// A learner's decks and their cards in all. The largest decks in common use
// (AnKing's medical deck, about 35,000 notes) fit; past that a deck is not
// reviewed at 20 new cards a day in a lifetime of study, and storage would
// grow without bound. Reaching the cards' limit keeps what was added and
// says how many were not (ImportResult.OverLimit).
const (
	MaxDecksPerLearner     = 100
	MaxDeckCardsPerLearner = 50000
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
	Front string     `json:"front"`
	Back  string     `json:"back"`
	Image *CardImage `json:"image,omitempty"`
}

// CardImage is a picture on a card's front, with its credit: Src is a file
// staged under /tool-runtime/ (package@version/file), Source the page it
// came from and Licence its licence's short name.
type CardImage struct {
	Src     string `json:"src"`
	Source  string `json:"source"`
	Licence string `json:"licence"`
}

// runtimeImage is a staged file's path: never a URL, so a card cannot load
// anything from elsewhere.
var runtimeImage = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*@[0-9][A-Za-z0-9.+-]*/[A-Za-z0-9][A-Za-z0-9._-]*\.(svg|png)$`)

func validImage(im *CardImage) bool {
	return im == nil || runtimeImage.MatchString(im.Src) && len(im.Src) <= 200 &&
		strings.HasPrefix(im.Source, "https://") && len(im.Source) <= 500 &&
		strings.TrimSpace(im.Licence) != "" && len(im.Licence) <= 60
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
	// Limit is the most general cards the learner may have, this batch included.
	Limit int
}

// DeckStore is the persistence decks need. pg.VocabStore implements it.
type DeckStore interface {
	// CreateDeck returns ErrLimit when the learner has `limit` decks already.
	CreateDeck(ctx context.Context, userID uuid.UUID, d NewDeck, limit int) (*Deck, error)
	// ListDecks counts each deck's cards due before `before`; zone renders
	// LastNew.
	ListDecks(ctx context.Context, userID uuid.UUID, before time.Time, zone string) ([]Deck, error)
	DeleteDeck(ctx context.Context, userID, id uuid.UUID) error
	// AddDeckCards inserts the batch, a card whose front the deck already
	// has counted as a duplicate and one past b.Limit as over the limit;
	// ErrNotFound for a deck not the user's.
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
	deck, err := store.CreateDeck(ctx, userID, d, MaxDecksPerLearner)
	if errors.Is(err, ErrLimit) {
		return nil, fmt.Errorf("%w: at most %d decks", ErrInvalid, MaxDecksPerLearner)
	}
	return deck, err
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
	b := DeckBatch{UserID: userID, DeckID: deckID, PerDay: ImportPerDay, Limit: MaxDeckCardsPerLearner}
	invalid := 0
	seen := map[string]bool{}
	for _, c := range cards {
		front, back := strings.TrimSpace(c.Front), strings.TrimSpace(c.Back)
		if front == "" || back == "" || utf8.RuneCountInString(front) > MaxDeckFront || utf8.RuneCountInString(back) > MaxDeckBack || !validImage(c.Image) {
			invalid++
			continue
		}
		// A card is its front and its picture: every flag card asks the same question.
		key := front
		if c.Image != nil {
			key += "\x00" + c.Image.Src
		}
		if seen[key] {
			continue // twice in one batch: the store counts the first one's duplicate
		}
		seen[key] = true
		b.Cards = append(b.Cards, DeckCard{Front: front, Back: back, Image: c.Image})
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
