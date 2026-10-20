package pg_test

import (
	"errors"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/vocab"
)

// card_decks_test.go is the general decks (plans/261020-1535-beyond-english-
// learning-areas, phase 5) over the real VocabStore: a deck's cards come up
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
	// f.now is 2026-09-27: tomorrow is the 28th; 20, 20 and 5.
	if res.Created != 45 || res.Duplicates != 1 || res.Invalid != 1 || res.FirstDay != "2026-09-28" || res.LastDay != "2026-09-30" {
		t.Fatalf("first batch: %+v", res)
	}
	// A second batch fills the 30th, then goes on.
	more, err := f.svc.AddDeckCards(ctx, f.alice, geo.ID, []vocab.DeckCard{
		{Front: "Country 0: capital?", Back: "a duplicate across batches"},
		{Front: "Extra 1", Back: "b"}, {Front: "Extra 2", Back: "b"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if more.Created != 2 || more.Duplicates != 1 || more.FirstDay != "2026-09-30" {
		t.Fatalf("second batch: %+v", more)
	}

	decks, err := f.svc.Decks(ctx, f.alice)
	if err != nil || len(decks) != 1 {
		t.Fatalf("decks: %v, %+v", err, decks)
	}
	if d := decks[0]; d.Cards != 47 || d.Due != 0 || d.New != 47 || d.LastNew != "2026-09-30" || d.Licence != "Public domain" {
		t.Fatalf("the deck's counts today: %+v", d)
	}
	// Not in the words' queue; the words' not in the cards'.
	if _, n, _ := f.svc.Due(ctx, f.alice, 0); n != 2 {
		t.Fatalf("%d words due, want the word's 2", n)
	}
	f.now = f.now.AddDate(0, 0, 1)
	due, n, err := f.svc.DueDeck(ctx, f.alice, vocab.DeckCards, 50)
	if err != nil || n != 20 || len(due) != 20 {
		t.Fatalf("cards due tomorrow: %d (%d listed), %v", n, len(due), err)
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
