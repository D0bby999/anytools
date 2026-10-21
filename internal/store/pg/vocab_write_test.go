package pg_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/vocab"
)

// vocab_write_test.go is the writing card (the private design notes, phase 3) over the real VocabStore: a Chinese or Japanese
// word being learned gets it on request, it shows the sentence with the word
// blanked, and turning it off suspends it without losing its schedule.

func TestVocabTheWritingCardIsForWordsWithCharactersToDraw(t *testing.T) {
	ctx, f := newVocabFixture(t)
	if _, err := f.svc.Import(ctx, f.alice, "ja", []vocab.ImportNote{{Term: "勉強", Meaning: "study", Sentence: "毎日勉強します。"}}); err != nil {
		t.Fatal(err)
	}
	list, err := f.svc.List(ctx, f.alice, vocab.Filter{Terms: []string{"勉強"}})
	if err != nil || len(list) != 1 {
		t.Fatalf("list: %v, %d", err, len(list))
	}
	ja := list[0]

	english := f.decide(t, ctx, "access mechanisms", vocab.DecisionLearn, learnRecord, "how a model reaches what it knows")
	if _, err := f.svc.Update(ctx, f.alice, english.ID, vocab.NotePatch{Writing: ptr(true)}); !errors.Is(err, vocab.ErrInvalid) {
		t.Fatalf("a writing card for an English word: %v", err)
	}
	if _, err := f.svc.Update(ctx, f.bob, ja.ID, vocab.NotePatch{Writing: ptr(true)}); !errors.Is(err, vocab.ErrNotFound) {
		t.Fatalf("Bob turning on Alice's writing card: %v", err)
	}

	on, err := f.svc.Update(ctx, f.alice, ja.ID, vocab.NotePatch{Writing: ptr(true)})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := activeCards(on)[vocab.KindWrite]; !on.Writing || !ok {
		t.Fatalf("after opting in: writing %v, cards %+v", on.Writing, on.Cards)
	}
	due := f.dueOfKind(t, ctx, vocab.KindWrite)
	if due == nil || due.Term != "勉強" || due.Meaning != "study" || strings.Contains(due.Cloze, "勉強") || due.Cloze == "" {
		t.Fatalf("the due writing card: %+v", due)
	}

	off, err := f.svc.Update(ctx, f.alice, ja.ID, vocab.NotePatch{Writing: ptr(false)})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := activeCards(off)[vocab.KindWrite]; off.Writing || ok {
		t.Fatalf("after opting out: writing %v, cards %+v", off.Writing, off.Cards)
	}
	if f.dueOfKind(t, ctx, vocab.KindWrite) != nil {
		t.Fatal("a writing card turned off is still due")
	}
	// Moving the word to English takes away what there is to draw.
	if _, err := f.svc.Update(ctx, f.alice, ja.ID, vocab.NotePatch{Writing: ptr(true), Lang: ptr("en")}); !errors.Is(err, vocab.ErrInvalid) {
		t.Fatalf("writing on with the language changed to English: %v", err)
	}
	// With the card on, a language with nothing to draw turns it off with it
	// (independent review): no writing card is left due for an English word.
	if _, err := f.svc.Update(ctx, f.alice, ja.ID, vocab.NotePatch{Writing: ptr(true)}); err != nil {
		t.Fatal(err)
	}
	moved, err := f.svc.Update(ctx, f.alice, ja.ID, vocab.NotePatch{Lang: ptr("en")})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := activeCards(moved)[vocab.KindWrite]; moved.Writing || ok || moved.Lang != "en" {
		t.Fatalf("after moving to English: lang %s, writing %v, cards %+v", moved.Lang, moved.Writing, moved.Cards)
	}
	if f.dueOfKind(t, ctx, vocab.KindWrite) != nil {
		t.Fatal("a writing card is due for a word moved to English")
	}
}

func TestWritable(t *testing.T) {
	for _, c := range []struct {
		term, lang string
		want       bool
	}{
		{"勉強", "ja", true}, {"ひらがな", "ja", true}, {"カタカナ", "ja-JP", true}, {"学习", "zh", true},
		{"學習", "zh-TW", true}, {"Tシャツ", "ja", true}, {"勉強", "en", false}, {"study", "ja", false},
		{"한국어", "ko", false}, {"123", "zh", false},
	} {
		if got := vocab.Writable(c.term, c.lang); got != c.want {
			t.Errorf("Writable(%q, %q) = %v, want %v", c.term, c.lang, got, c.want)
		}
	}
}
