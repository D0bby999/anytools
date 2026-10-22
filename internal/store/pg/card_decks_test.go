package pg_test

import (
	"errors"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/vocab"
)

// card_decks_test.go is the general decks (the private design notes, phase 5) over the real VocabStore: a deck's cards come up
// twenty a day after the earlier deck imports, a front the deck has is a
// duplicate, they are their own queue and not the words', they are the
// learner's own, and they go with their deck.

func TestDecksComeUpTwentyADayAndAreTheirOwnQueue(t *testing.T) {
	ctx, f := newVocabFixture(t)
	f.save(t, ctx, "knowledge", ragSelection) // a word: its two cards are due today
	if _, err := f.svc.CreateDeck(ctx, f.alice, vocab.NewDeck{Name: " "}); !errors.Is(err, vocab.ErrInvalid) {
		t.Fatalf("a deck without a name: %v", err)
	}
	if _, err := f.svc.CreateDeck(ctx, f.alice, vocab.NewDeck{Name: "x", SourceURL: "javascript:alert(1)"}); !errors.Is(err, vocab.ErrInvalid) {
		t.Fatalf("a deck with a script link: %v", err)
	}
	geo, err := f.svc.CreateDeck(ctx, f.alice, vocab.NewDeck{Name: "Geography", Source: "library:ultimate-geography-en",
		Licence: "Public domain", SourceURL: "https://github.com/anki-geo/ultimate-geography"})
	if err != nil {
		t.Fatal(err)
	}
	cards := make([]vocab.DeckCard, 0, 45)
	for i := range 45 {
		cards = append(cards, vocab.DeckCard{Front: fmt.Sprintf("Country %d: capital?", i), Back: fmt.Sprintf("City %d", i)})
	}
	cards = append(cards, vocab.DeckCard{Front: "Country 0: capital?", Back: "again"}, vocab.DeckCard{Front: "", Back: "no front"})
	res, err := f.svc.AddDeckCards(ctx, f.alice, geo.ID, cards)
	if err != nil {
		t.Fatal(err)
	}
	// f.now is 2026-09-27, and new cards start today: 20, 20 and 5.
	if res.Created != 45 || res.Duplicates != 1 || res.Invalid != 1 || res.FirstDay != "2026-09-27" || res.LastDay != "2026-09-29" {
		t.Fatalf("first batch: %+v", res)
	}
	// A second batch fills the 29th, then goes on.
	more, err := f.svc.AddDeckCards(ctx, f.alice, geo.ID, []vocab.DeckCard{
		{Front: "Country 0: capital?", Back: "a duplicate across batches"},
		{Front: "Extra 1", Back: "b"}, {Front: "Extra 2", Back: "b"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if more.Created != 2 || more.Duplicates != 1 || more.FirstDay != "2026-09-29" {
		t.Fatalf("second batch: %+v", more)
	}

	decks, err := f.svc.Decks(ctx, f.alice)
	if err != nil || len(decks) != 1 {
		t.Fatalf("decks: %v, %+v", err, decks)
	}
	if d := decks[0]; d.Cards != 47 || d.Due != 20 || d.New != 47 || d.LastNew != "2026-09-29" || d.Licence != "Public domain" {
		t.Fatalf("the deck's counts today: %+v", d)
	}
	// Not in the words' queue; the words' not in the cards'.
	if _, n, _ := f.svc.Due(ctx, f.alice, 0); n != 2 {
		t.Fatalf("%d words due, want the word's 2", n)
	}
	due, n, err := f.svc.DueDeck(ctx, f.alice, vocab.DeckCards, 50)
	if err != nil || n != 20 || len(due) != 20 {
		t.Fatalf("cards due today: %d (%d listed), %v", n, len(due), err)
	}
	c := due[0]
	if c.Kind != vocab.KindCard || c.Front != "Country 0: capital?" || c.Back != "City 0" || c.Deck == nil || c.Deck.Name != "Geography" {
		t.Fatalf("a due deck card: %+v", c)
	}
	if _, err := f.svc.Review(ctx, f.alice, c.ID, vocab.ReviewInput{Rating: "good", RequestID: uuid.New()}); err != nil {
		t.Fatalf("reviewing a deck card: %v", err)
	}

	// Bob can neither add to Alice's deck nor delete it.
	if _, err := f.svc.AddDeckCards(ctx, f.bob, geo.ID, []vocab.DeckCard{{Front: "f", Back: "b"}}); !errors.Is(err, vocab.ErrNotFound) {
		t.Fatalf("Bob adding to Alice's deck: %v", err)
	}
	if err := f.svc.DeleteDeck(ctx, f.bob, geo.ID); !errors.Is(err, vocab.ErrNotFound) {
		t.Fatalf("Bob deleting Alice's deck: %v", err)
	}
	if bobs, _ := f.svc.Decks(ctx, f.bob); len(bobs) != 0 {
		t.Fatalf("Bob sees decks: %+v", bobs)
	}
	if err := f.svc.DeleteDeck(ctx, f.alice, geo.ID); err != nil {
		t.Fatal(err)
	}
	var left int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM vocab_cards WHERE user_id = $1 AND kind = 'card'`, f.alice).Scan(&left); err != nil || left != 0 {
		t.Fatalf("%d deck cards left after deleting the deck, %v", left, err)
	}
}

// TestDeckLimitsKeepWhatFits: a learner's decks and general cards have a
// ceiling. A deck past it is refused; a batch reaching it adds what fits and
// counts the rest as over the limit, so an import keeps its first part.
func TestDeckLimitsKeepWhatFits(t *testing.T) {
	ctx, f := newVocabFixture(t)
	first, err := f.store.CreateDeck(ctx, f.alice, vocab.NewDeck{Name: "One"}, 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.store.CreateDeck(ctx, f.alice, vocab.NewDeck{Name: "Two"}, 1); !errors.Is(err, vocab.ErrLimit) {
		t.Fatalf("a deck past the limit: %v", err)
	}
	if _, err := f.store.CreateDeck(ctx, f.bob, vocab.NewDeck{Name: "Bob's"}, 1); err != nil {
		t.Fatalf("another learner's limit is their own: %v", err)
	}

	batch := func(fronts ...string) vocab.DeckBatch {
		b := vocab.DeckBatch{UserID: f.alice, DeckID: first.ID, Zone: "UTC", PerDay: 20, Now: f.now, Limit: 3}
		b.FirstDay = vocab.AddDays(learning.LocalDay(f.now, "UTC"), 1)
		for _, front := range fronts {
			b.Cards = append(b.Cards, vocab.DeckCard{Front: front, Back: "back"})
		}
		return b
	}
	res, err := f.store.AddDeckCards(ctx, batch("a", "b", "c", "d", "e"))
	if err != nil {
		t.Fatal(err)
	}
	if res.Created != 3 || res.OverLimit != 2 {
		t.Fatalf("the first batch: %+v, want 3 created and 2 over the limit", res)
	}
	res, err = f.store.AddDeckCards(ctx, batch("a", "f"))
	if err != nil {
		t.Fatal(err)
	}
	if res.Created != 0 || res.Duplicates != 1 || res.OverLimit != 1 {
		t.Fatalf("at the limit: %+v, want the duplicate counted and the new one over", res)
	}
}

// TestDeckCardsCarryTheirPicture: a card's picture is kept and read back
// with its credit; two cards asking the same question about different
// pictures are two cards; a picture that is not a staged file is refused.
func TestDeckCardsCarryTheirPicture(t *testing.T) {
	ctx, f := newVocabFixture(t)
	deck, err := f.svc.CreateDeck(ctx, f.alice, vocab.NewDeck{Name: "Flags"})
	if err != nil {
		t.Fatal(err)
	}
	flag := func(file string) *vocab.CardImage {
		return &vocab.CardImage{Src: "ultimate-geography-media@5.3/" + file, Source: "https://commons.wikimedia.org/wiki/File:" + file, Licence: "PD"}
	}
	res, err := f.svc.AddDeckCards(ctx, f.alice, deck.ID, []vocab.DeckCard{
		{Front: "Which country's flag is this?", Back: "France", Image: flag("ug-flag-france.svg")},
		{Front: "Which country's flag is this?", Back: "Japan", Image: flag("ug-flag-japan.svg")},
		{Front: "Which country's flag is this?", Back: "Japan", Image: flag("ug-flag-japan.svg")},
		{Front: "Which country's flag is this?", Back: "Elsewhere", Image: &vocab.CardImage{Src: "https://example.com/x.png", Source: "https://example.com", Licence: "PD"}},
		{Front: "Which country's flag is this?", Back: "No credit", Image: &vocab.CardImage{Src: "ultimate-geography-media@5.3/ug-flag-chad.svg"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Created != 2 || res.Duplicates != 1 || res.Invalid != 2 {
		t.Fatalf("added %+v, want 2 created, 1 duplicate, 2 invalid", res)
	}
	// New cards come up today.
	due, _, err := f.svc.DueDeck(ctx, f.alice, vocab.DeckCards, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(due) != 2 || due[0].Image == nil || *due[0].Image != *flag("ug-flag-france.svg") {
		t.Fatalf("due %+v, want both cards, France's with its picture and credit", due)
	}
}
