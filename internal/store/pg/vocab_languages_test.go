package pg_test

import (
	"errors"
	"slices"
	"testing"

	"github.com/D0bby999/anytools/internal/vocab"
)

// vocab_languages_test.go is the Languages page's list and counts
// (plans/261020-1535-beyond-english-learning-areas, phase 1).

func TestVocabStudiedLanguagesAreTheLearnersOwn(t *testing.T) {
	ctx, f := newVocabFixture(t)
	got, err := f.svc.Languages(ctx, f.alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Languages) != 0 || got.Current != "" || len(got.Saved) != 0 {
		t.Fatalf("a new learner has no languages yet: %+v", got)
	}
	set, err := f.svc.SetLanguages(ctx, f.alice, vocab.Studied{Languages: []string{"ja", " en", "ja"}})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(set.Languages, []string{"ja", "en"}) || set.Current != "ja" {
		t.Fatalf("set = %+v, want [ja en] in order without repeats, current the first", set)
	}
	if _, err := f.svc.SetLanguages(ctx, f.alice, vocab.Studied{Languages: []string{"en"}, Current: "fr"}); !errors.Is(err, vocab.ErrInvalid) {
		t.Fatalf("a current language off the list: err = %v", err)
	}
	if _, err := f.svc.SetLanguages(ctx, f.alice, vocab.Studied{Languages: []string{"english"}}); !errors.Is(err, vocab.ErrInvalid) {
		t.Fatalf("a name is not a code: err = %v", err)
	}
	if _, err := f.svc.SetLanguages(ctx, f.alice, vocab.Studied{Languages: []string{"en", "ja"}, Current: "en"}); err != nil {
		t.Fatal(err)
	}
	got, _ = f.svc.Languages(ctx, f.alice)
	if !slices.Equal(got.Languages, []string{"en", "ja"}) || got.Current != "en" {
		t.Fatalf("after the second save: %+v", got)
	}
	bob, err := f.svc.Languages(ctx, f.bob)
	if err != nil || len(bob.Languages) != 0 {
		t.Fatalf("another learner's list leaked: %+v, %v", bob, err)
	}
	// An empty list is a learner who took every tab off.
	if out, err := f.svc.SetLanguages(ctx, f.alice, vocab.Studied{}); err != nil || len(out.Languages) != 0 || out.Current != "" {
		t.Fatalf("empty list: %+v, %v", out, err)
	}
}

func TestVocabDueNarrowsToOneLanguage(t *testing.T) {
	ctx, f := newVocabFixture(t)
	f.save(t, ctx, "knowledge", ragSelection) // English, both cards due today
	if _, err := f.svc.Import(ctx, f.alice, "ja", []vocab.ImportNote{{Term: "勉強", Meaning: "study"}}); err != nil {
		t.Fatal(err)
	}
	got, err := f.svc.Languages(ctx, f.alice)
	if err != nil {
		t.Fatal(err)
	}
	want := []vocab.LangCount{{Lang: "en", Words: 1, Due: 2}, {Lang: "ja", Words: 1, Due: 0}}
	if !slices.Equal(got.Saved, want) {
		t.Fatalf("saved = %+v, want %+v (the import starts tomorrow)", got.Saved, want)
	}
	cards, n, err := f.svc.DueIn(ctx, f.alice, vocab.DeckWords, "en", 50)
	if err != nil || n != 2 || len(cards) != 2 || cards[0].Lang != "en" {
		t.Fatalf("en: %d due, %d cards, %v", n, len(cards), err)
	}
	if _, n, _ := f.svc.DueIn(ctx, f.alice, vocab.DeckWords, "ja", 50); n != 0 {
		t.Fatalf("ja: %d due today, want 0", n)
	}
	f.now = f.now.AddDate(0, 0, 2)
	cards, n, err = f.svc.DueIn(ctx, f.alice, vocab.DeckWords, "ja", 50)
	if err != nil || n != 1 || len(cards) != 1 || cards[0].Term != "勉強" {
		t.Fatalf("ja two days on: %d due, %+v, %v", n, cards, err)
	}
	if _, n, _ := f.svc.DueIn(ctx, f.alice, vocab.DeckWords, "", 0); n != 3 {
		t.Fatalf("every language: %d due, want 3", n)
	}
	if _, n, _ := f.svc.DueIn(ctx, f.bob, vocab.DeckWords, "ja", 0); n != 0 {
		t.Fatalf("bob sees alice's words: %d", n)
	}
	if _, _, err := f.svc.DueIn(ctx, f.alice, vocab.DeckBook, "ja", 0); !errors.Is(err, vocab.ErrInvalid) {
		t.Fatalf("a book's cards have no language: err = %v", err)
	}
}
