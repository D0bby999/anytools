package pg_test

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/vocab"
)

// vocab_import_test.go is an Anki deck's words (the private design notes, phase 3) over the real VocabStore: each becomes a word to learn,
// marked as imported, with a cloze card only when its sentence holds it;
// duplicates and empty words are counted, not saved; and the words come up
// twenty a day from the learner's tomorrow, the next batch carrying on where
// the last left off. They are not the week's "five to eight".

func TestVocabAnImportedDeckComesUpTwentyADay(t *testing.T) {
	ctx, f := newVocabFixture(t)
	// The learner's tomorrow starts 2026-09-28 (f.now is the 27th, UTC).
	f.save(t, ctx, "knowledge", ragSelection)

	notes := []vocab.ImportNote{
		{Term: "equilibrium", Meaning: "a balanced state", Sentence: "The market reached equilibrium by noon."},
		{Term: "entropy", Meaning: "disorder", Sentence: "This sentence does not hold it."},
		{Term: "Knowledge", Meaning: "already saved, case aside"},
		{Term: "equilibrium", Meaning: "twice in one batch"},
		{Term: "  ", Meaning: "no term"},
		{Term: "lonely", Meaning: ""},
		{Term: strings.Repeat("x", vocab.MaxTermLen+1), Meaning: "too long to be one term"},
	}
	res, err := f.svc.Import(ctx, f.alice, "en", notes)
	if err != nil {
		t.Fatal(err)
	}
	if res.Created != 2 || res.Duplicates != 2 || res.Invalid != 3 || res.FirstDay != "2026-09-28" || res.LastDay != "2026-09-28" {
		t.Fatalf("result = %+v", res)
	}
	list, err := f.svc.List(ctx, f.alice, vocab.Filter{Terms: []string{"equilibrium", "entropy"}})
	if err != nil {
		t.Fatal(err)
	}
	byTerm := map[string]vocab.Note{}
	for _, n := range list {
		byTerm[n.Term] = n
	}
	eq, en := byTerm["equilibrium"], byTerm["entropy"]
	if eq.Origin != vocab.OriginAnki || eq.Decision != vocab.DecisionLearn || len(eq.Cards) != 2 || eq.Meaning != "a balanced state" ||
		len(eq.Contexts) != 1 || eq.Source != nil {
		t.Fatalf("equilibrium = %+v", eq)
	}
	if len(en.Cards) != 1 || en.Cards[0].Kind != vocab.KindRecognition || len(en.Contexts) != 0 {
		t.Fatalf("entropy: a sentence without the term gives no cloze: %+v", en)
	}
	// Not due today; and not the week's deliberate choices.
	_, due, _ := f.svc.Due(ctx, f.alice, 0)
	if due != 2 { // "knowledge"'s two cards only
		t.Fatalf("%d due today, want only the word saved while reading", due)
	}
	if week, _ := f.svc.Week(ctx, f.alice); week.Learning != 1 {
		t.Fatalf("week counts %d, want the one word chosen while reading", week.Learning)
	}

	// 45 more: 18 fill the 28th (2 there already), 20 the 29th, 7 the 30th.
	more := make([]vocab.ImportNote, 45)
	for i := range more {
		more[i] = vocab.ImportNote{Term: fmt.Sprintf("word%02d", i), Meaning: "m"}
	}
	res, err = f.svc.Import(ctx, f.alice, "en", more)
	if err != nil {
		t.Fatal(err)
	}
	if res.Created != 45 || res.FirstDay != "2026-09-28" || res.LastDay != "2026-09-30" {
		t.Fatalf("second batch = %+v", res)
	}
	perDay := map[string]int{}
	rows, err := f.pool.Query(ctx, `
		SELECT c.due_at FROM vocab_cards c JOIN vocab_notes n ON n.id = c.note_id
		 WHERE n.user_id = $1 AND n.origin = 'anki' AND c.kind = 'recognition'`, f.alice)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var d time.Time
		_ = rows.Scan(&d)
		perDay[d.UTC().Format(time.DateOnly)]++
	}
	rows.Close()
	if perDay["2026-09-28"] != 20 || perDay["2026-09-29"] != 20 || perDay["2026-09-30"] != 7 {
		t.Fatalf("per day = %v", perDay)
	}

	// Bob's import never meets Alice's words.
	if res, err := f.svc.Import(ctx, f.bob, "en", []vocab.ImportNote{{Term: "equilibrium", Meaning: "m"}}); err != nil || res.Created != 1 || res.FirstDay != "2026-09-28" {
		t.Fatalf("Bob's import = %+v, %v", res, err)
	}

	for name, tc := range map[string]struct {
		lang  string
		notes []vocab.ImportNote
	}{
		"no words":       {"en", nil},
		"too many":       {"en", make([]vocab.ImportNote, vocab.MaxImportBatch+1)},
		"not a language": {"english", []vocab.ImportNote{{Term: "a", Meaning: "b"}}},
	} {
		if _, err := f.svc.Import(ctx, f.alice, tc.lang, tc.notes); !errors.Is(err, vocab.ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
}
