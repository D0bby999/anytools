package pg_test

import (
	"errors"
	"fmt"
	"testing"

	"github.com/D0bby999/anytools/internal/vocab"
)

// A mistake corrected in chat (the private design notes, phase 3) is
// a word to learn with no document behind it: due today even behind a word
// list's queue, a cloze card only when its sentence holds the right words,
// and a production card on request.
func TestVocabAChatCorrectionIsDueToday(t *testing.T) {
	ctx, f := newVocabFixture(t)
	// A word list already fills today and the days after: corrections are
	// not paced behind it.
	list := make([]vocab.ImportNote, 60)
	for i := range list {
		list[i] = vocab.ImportNote{Term: fmt.Sprintf("word%02d", i), Meaning: "m"}
	}
	if _, err := f.svc.ImportFrom(ctx, f.alice, "en", "library:ngsl-1", list); err != nil {
		t.Fatal(err)
	}
	_, before, _ := f.svc.Due(ctx, f.alice, 0)

	note, created, err := f.svc.SaveCorrection(ctx, f.alice, "en", "/chat/0f0e0d0c-0b0a-4908-8706-050403020100", vocab.CorrectionInput{
		Wrong: "I go", Right: "I went", Why: "Quá khứ: dùng went.", Sentence: "Yesterday I went to the meeting.", Production: true,
	})
	if err != nil || !created {
		t.Fatalf("save: %v %v", created, err)
	}
	if note.Origin != vocab.OriginChat || note.Decision != vocab.DecisionLearn || note.Meaning != "Quá khứ: dùng went." ||
		note.Record["cue"] != "I go" || note.Source != nil || len(note.Contexts) != 1 || note.Contexts[0].URL == "" {
		t.Fatalf("note = %+v", note)
	}
	kinds := map[string]bool{}
	for _, c := range note.Cards {
		kinds[c.Kind] = true
	}
	if !kinds[vocab.KindRecognition] || !kinds[vocab.KindCloze] || !kinds[vocab.KindProduction] {
		t.Fatalf("cards = %+v", note.Cards)
	}
	if _, after, _ := f.svc.Due(ctx, f.alice, 0); after <= before {
		t.Fatalf("due %d → %d: the correction is not in today's review", before, after)
	}

	// No sentence holding the right words: a recognition card only.
	bare, _, err := f.svc.SaveCorrection(ctx, f.alice, "en", "", vocab.CorrectionInput{Wrong: "everybodies", Right: "everybody", Sentence: "I said hello to all."})
	if err != nil || len(bare.Cards) != 1 || bare.Cards[0].Kind != vocab.KindRecognition || bare.Meaning != "everybody" {
		t.Fatalf("bare = %+v, %v", bare, err)
	}
	for name, in := range map[string]vocab.CorrectionInput{
		"no right words": {Wrong: "x"},
		"a far link":     {Right: "y"},
	} {
		link := ""
		if name == "a far link" {
			link = "https://example.com"
		}
		if _, _, err := f.svc.SaveCorrection(ctx, f.alice, "en", link, in); !errors.Is(err, vocab.ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
}
