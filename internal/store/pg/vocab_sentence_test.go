package pg_test

import (
	"errors"
	"testing"

	"github.com/D0bby999/anytools/internal/vocab"
)

// A sentence from an open source (the private design notes,
// phase 6) becomes the word's newest context, credited, and gives a word
// being learned its cloze card.
func TestVocabASentenceFromASourceGivesTheClozeCard(t *testing.T) {
	ctx, f := newVocabFixture(t)
	if _, err := f.svc.ImportFrom(ctx, f.alice, "en", "library:ngsl-1", []vocab.ImportNote{{Term: "carefully", Meaning: "with care"}}); err != nil {
		t.Fatal(err)
	}
	list, err := f.svc.List(ctx, f.alice, vocab.Filter{Terms: []string{"carefully"}})
	if err != nil || len(list) != 1 {
		t.Fatalf("list: %v, %d", err, len(list))
	}
	word := list[0]
	if _, ok := activeCards(&word)[vocab.KindCloze]; ok {
		t.Fatal("a word without a sentence has a cloze card")
	}

	const credit = "Tatoeba, CK, CC BY 2.0 FR"
	got, err := f.svc.AddSentence(ctx, f.alice, word.ID, "Watch carefully.", credit, "https://tatoeba.org/en/sentences/show/2107662")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Contexts) != 1 || got.Contexts[0].Sentence != "Watch carefully." || got.Contexts[0].Credit != credit || got.Contexts[0].URL == "" {
		t.Fatalf("contexts = %+v", got.Contexts)
	}
	if _, ok := activeCards(got)[vocab.KindCloze]; !ok {
		t.Fatalf("no cloze card: %+v", got.Cards)
	}
	// The same sentence again is not repeated.
	if again, err := f.svc.AddSentence(ctx, f.alice, word.ID, "Watch carefully.", credit, ""); err != nil || len(again.Contexts) != 1 {
		t.Fatalf("again: %v, %+v", err, again)
	}

	for name, tc := range map[string][3]string{
		"without the word": {"Watch out.", credit, ""},
		"no credit":        {"Drive carefully.", "", ""},
		"not https":        {"Drive carefully.", credit, "http://tatoeba.org/x"},
	} {
		if _, err := f.svc.AddSentence(ctx, f.alice, word.ID, tc[0], tc[1], tc[2]); !errors.Is(err, vocab.ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, err := f.svc.AddSentence(ctx, f.bob, word.ID, "Drive carefully.", credit, ""); !errors.Is(err, vocab.ErrNotFound) {
		t.Fatalf("Bob adding to Alice's word: %v", err)
	}
}
