package pg_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/vocab"
)

// vocab_decisions_test.go is up's five decisions about an unknown word and
// the production card (plans/260930-0915-up-methods, phase 3) over the real
// VocabStore: only a word to learn has cards in review (AC5), a decision
// changes by PATCH and never by a second save, and moving between decisions
// suspends and resumes the same cards.

func (f *vocabFixture) decide(t *testing.T, ctx context.Context, term, decision string, record map[string]string, meaning string) *vocab.Note {
	t.Helper()
	n, _, err := f.svc.Save(ctx, f.alice, vocab.SaveInput{
		WorkspaceID: f.workspace, Page: 2, Selection: ragSelection, Term: term, Meaning: meaning,
		Decision: decision, Record: record,
	})
	if err != nil {
		t.Fatalf("Save(%q, %s): %v", term, decision, err)
	}
	return n
}

var learnRecord = map[string]string{"sound": "PREE-trained", "collocation": "pre-trained model", "cue": "a model trained before the task"}

// activeCards is the note's cards that are in review, by kind.
func activeCards(n *vocab.Note) map[string]vocab.CardSummary {
	out := map[string]vocab.CardSummary{}
	for _, c := range n.Cards {
		if !c.Suspended {
			out[c.Kind] = c
		}
	}
	return out
}

func TestVocabASkippedWordHasNoCardsAndNeedsNoMeaning(t *testing.T) {
	ctx, f := newVocabFixture(t)
	n := f.decide(t, ctx, "Crucially", vocab.DecisionSkip, map[string]string{"why": "it only adds emphasis"}, "")
	if n.Decision != vocab.DecisionSkip || n.Meaning != "" || n.Record["why"] != "it only adds emphasis" {
		t.Fatalf("note = %+v", n)
	}
	if len(n.Cards) != 0 {
		t.Fatalf("a skipped word has cards: %+v", n.Cards)
	}
	for _, d := range []struct {
		decision string
		record   map[string]string
		term     string
	}{
		{vocab.DecisionInfer, map[string]string{"sense": "learned beforehand", "confidence": "medium"}, "pre-trained"},
		{vocab.DecisionVerify, map[string]string{"definition": "d", "scope": "s", "owner": "o"}, "access mechanisms"},
	} {
		if n := f.decide(t, ctx, d.term, d.decision, d.record, ""); len(n.Cards) != 0 {
			t.Errorf("%s: cards %+v", d.decision, n.Cards)
		}
	}
	_, due, err := f.svc.Due(ctx, f.alice, 0)
	if err != nil || due != 0 {
		t.Fatalf("due after skip, infer and verify: %d, %v", due, err)
	}
	// A quick lookup has no cards either, and its meaning is its current sense.
	if _, _, err := f.svc.Save(ctx, f.alice, vocab.SaveInput{WorkspaceID: f.workspace, Page: 2, Selection: ragSelection,
		Term: "training", Decision: vocab.DecisionLookup, Record: map[string]string{"source": "Cambridge"}}); !errors.Is(err, vocab.ErrInvalid) {
		t.Fatalf("a lookup without its current sense: %v", err)
	}
}

func TestVocabEachDecisionNeedsItsMinimumRecord(t *testing.T) {
	ctx, f := newVocabFixture(t)
	for name, in := range map[string]struct {
		decision string
		record   map[string]string
	}{
		"skip without why":           {vocab.DecisionSkip, map[string]string{}},
		"infer without a confidence": {vocab.DecisionInfer, map[string]string{"sense": "s"}},
		"infer, confidence unsure":   {vocab.DecisionInfer, map[string]string{"sense": "s", "confidence": "unsure"}},
		"lookup without a source":    {vocab.DecisionLookup, map[string]string{}},
		"learn without a cue":        {vocab.DecisionLearn, map[string]string{"sound": "s", "collocation": "c"}},
		"verify without an owner":    {vocab.DecisionVerify, map[string]string{"definition": "d", "scope": "s"}},
		"a field of another record":  {vocab.DecisionSkip, map[string]string{"why": "w", "sense": "s"}},
		"an unknown decision":        {"memorise", map[string]string{"why": "w"}},
		"an over-long record":        {vocab.DecisionSkip, map[string]string{"why": strings.Repeat("w", vocab.MaxRecordLen+1)}},
	} {
		_, _, err := f.svc.Save(ctx, f.alice, vocab.SaveInput{
			WorkspaceID: f.workspace, Page: 2, Selection: ragSelection, Term: "ability", Meaning: "m",
			Decision: in.decision, Record: in.record,
		})
		if !errors.Is(err, vocab.ErrInvalid) {
			t.Errorf("%s: %v, want ErrInvalid", name, err)
		}
	}
	if _, _, err := f.svc.Save(ctx, f.alice, vocab.SaveInput{
		WorkspaceID: f.workspace, Page: 2, Selection: ragSelection, Term: "ability", Meaning: "m",
		Decision: vocab.DecisionSkip, Record: map[string]string{"why": "w"}, TaskImpact: "huge",
	}); !errors.Is(err, vocab.ErrInvalid) {
		t.Errorf("a task impact outside up's four: %v", err)
	}
	var notes int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM vocab_notes WHERE user_id = $1`, f.alice).Scan(&notes)
	if notes != 0 {
		t.Fatalf("%d notes saved by refused requests", notes)
	}
}

func TestVocabASecondSaveKeepsTheDecisionAndAPatchChangesIt(t *testing.T) {
	ctx, f := newVocabFixture(t)
	first := f.decide(t, ctx, "ability", vocab.DecisionSkip, map[string]string{"why": "w"}, "")
	again := f.decide(t, ctx, "ability", vocab.DecisionLearn, learnRecord, "the power to do something")
	if again.ID != first.ID || again.Decision != vocab.DecisionSkip || len(again.Cards) != 0 || again.Record["why"] != "w" {
		t.Fatalf("a second save changed the note: %+v", again)
	}
	patched, err := f.svc.Update(ctx, f.alice, first.ID, vocab.NotePatch{
		Decision: ptr(vocab.DecisionLearn), Record: learnRecord, Meaning: ptr("the power to do something")})
	if err != nil {
		t.Fatal(err)
	}
	if patched.Decision != vocab.DecisionLearn || len(activeCards(patched)) != 2 {
		t.Fatalf("skip → learn: decision %q, cards %+v", patched.Decision, patched.Cards)
	}
	if !patched.DecidedAt.After(first.DecidedAt) {
		t.Errorf("decided_at did not move with the decision: %v → %v", first.DecidedAt, patched.DecidedAt)
	}
	// A PATCH to learn brings learn's record and a meaning.
	other := f.decide(t, ctx, "training", vocab.DecisionSkip, map[string]string{"why": "w"}, "")
	if _, err := f.svc.Update(ctx, f.alice, other.ID, vocab.NotePatch{Decision: ptr(vocab.DecisionLearn), Record: learnRecord}); !errors.Is(err, vocab.ErrInvalid) {
		t.Errorf("learn without a meaning: %v", err)
	}
	if _, err := f.svc.Update(ctx, f.alice, other.ID, vocab.NotePatch{Decision: ptr(vocab.DecisionLearn), Meaning: ptr("m")}); !errors.Is(err, vocab.ErrInvalid) {
		t.Errorf("learn keeping skip's record: %v", err)
	}
	if _, err := f.svc.Update(ctx, f.alice, other.ID, vocab.NotePatch{Decision: ptr("memorise")}); !errors.Is(err, vocab.ErrInvalid) {
		t.Errorf("an unknown decision: %v", err)
	}
	if n, _ := f.svc.Get(ctx, f.alice, other.ID); n.Decision != vocab.DecisionSkip || len(n.Cards) != 0 {
		t.Fatalf("refused patches changed the note: %+v", n)
	}
	// Bob's PATCH of Alice's note is a 404, decision or not.
	if _, err := f.svc.Update(ctx, f.bob, other.ID, vocab.NotePatch{
		Decision: ptr(vocab.DecisionSkip), Record: map[string]string{"why": "x"}}); !errors.Is(err, vocab.ErrNotFound) {
		t.Errorf("another user's patch: %v", err)
	}
}

func TestVocabLearnSkipLearnResumesTheSameCards(t *testing.T) {
	ctx, f := newVocabFixture(t)
	n := f.decide(t, ctx, "pre-trained", vocab.DecisionLearn, learnRecord, "trained beforehand")
	before := activeCards(n)
	if len(before) != 2 {
		t.Fatalf("learn: cards %+v", n.Cards)
	}
	skipped, err := f.svc.Update(ctx, f.alice, n.ID, vocab.NotePatch{
		Decision: ptr(vocab.DecisionSkip), Record: map[string]string{"why": "not needed this cycle"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(skipped.Cards) != 2 || len(activeCards(skipped)) != 0 {
		t.Fatalf("learn → skip: cards %+v, want both kept and suspended", skipped.Cards)
	}
	if _, due, _ := f.svc.Due(ctx, f.alice, 0); due != 0 {
		t.Fatalf("%d cards due after skip", due)
	}
	// Resuming a skipped word's cards is refused: only a word to learn has
	// cards in review.
	if _, err := f.svc.Update(ctx, f.alice, n.ID, vocab.NotePatch{Suspended: ptr(false)}); !errors.Is(err, vocab.ErrInvalid) {
		t.Fatalf("resuming a skipped word: %v", err)
	}
	back, err := f.svc.Update(ctx, f.alice, n.ID, vocab.NotePatch{Decision: ptr(vocab.DecisionLearn), Record: learnRecord})
	if err != nil {
		t.Fatalf("skip → learn: %v", err)
	}
	after := activeCards(back)
	if len(back.Cards) != 2 || len(after) != 2 {
		t.Fatalf("learn → skip → learn: cards %+v", back.Cards)
	}
	for kind, c := range before {
		if after[kind].ID != c.ID {
			t.Errorf("%s card replaced (%s → %s), want the same card resumed", kind, c.ID, after[kind].ID)
		}
	}
	if _, due, _ := f.svc.Due(ctx, f.alice, 0); due != 2 {
		t.Fatalf("%d cards due after learn again, want 2", due)
	}
}

func TestVocabTheProductionCardIsOptInAndScheduledApart(t *testing.T) {
	ctx, f := newVocabFixture(t)
	n := f.decide(t, ctx, "access mechanisms", vocab.DecisionLearn, learnRecord, "how a model reaches what it knows")
	if len(n.Cards) != 2 || n.Production {
		t.Fatalf("a new word to learn: production %v, cards %+v", n.Production, n.Cards)
	}
	if _, err := f.svc.Practise(ctx, f.alice, n.ID, "  ", ""); !errors.Is(err, vocab.ErrInvalid) {
		t.Fatalf("no scenario: %v", err)
	}
	if _, err := f.svc.Practise(ctx, f.alice, n.ID, strings.Repeat("s", vocab.MaxScenarioLen+1), ""); !errors.Is(err, vocab.ErrInvalid) {
		t.Fatalf("an over-long scenario: %v", err)
	}
	if _, err := f.svc.Practise(ctx, f.bob, n.ID, "a scenario", ""); !errors.Is(err, vocab.ErrNotFound) {
		t.Fatalf("Bob's practise on Alice's note: %v", err)
	}
	on, err := f.svc.Practise(ctx, f.alice, n.ID, "explaining retrieval to a colleague", "access points: places, not means")
	if err != nil {
		t.Fatal(err)
	}
	prod, ok := activeCards(on)[vocab.KindProduction]
	if !on.Production || !ok || len(on.Cards) != 3 {
		t.Fatalf("after opting in: production %v, cards %+v", on.Production, on.Cards)
	}

	cards, _, err := f.svc.Due(ctx, f.alice, 10)
	if err != nil {
		t.Fatal(err)
	}
	var due *vocab.DueCard
	for i := range cards {
		if cards[i].Kind == vocab.KindProduction {
			due = &cards[i]
		}
	}
	if due == nil || due.Scenario != "explaining retrieval to a colleague" || due.Confusable != "access points: places, not means" {
		t.Fatalf("the due production card: %+v", due)
	}
	// Its own schedule: reviewing it moves it, and only it.
	res, err := f.svc.Review(ctx, f.alice, prod.ID, vocab.ReviewInput{Rating: "good", Answer: "Access mechanisms", RequestID: uuid.New()})
	if err != nil {
		t.Fatal(err)
	}
	if res.Matched == nil || !*res.Matched || res.Reps != 1 {
		t.Fatalf("a typed production answer: %+v", res)
	}
	after, _ := f.svc.Get(ctx, f.alice, n.ID)
	for _, c := range after.Cards {
		if c.Kind != vocab.KindProduction && c.Reps != 0 {
			t.Errorf("%s card reviewed by the production card's answer: %+v", c.Kind, c)
		}
	}

	// Off suspends it, schedule kept; resuming the note leaves it off.
	off, err := f.svc.Update(ctx, f.alice, n.ID, vocab.NotePatch{Production: ptr(false)})
	if err != nil {
		t.Fatal(err)
	}
	if _, active := activeCards(off)[vocab.KindProduction]; active || off.Production || len(activeCards(off)) != 2 {
		t.Fatalf("production off: %+v", off.Cards)
	}
	if _, err := f.svc.Update(ctx, f.alice, n.ID, vocab.NotePatch{Suspended: ptr(true)}); err != nil {
		t.Fatal(err)
	}
	resumed, err := f.svc.Update(ctx, f.alice, n.ID, vocab.NotePatch{Suspended: ptr(false)})
	if err != nil {
		t.Fatal(err)
	}
	if _, active := activeCards(resumed)[vocab.KindProduction]; active || len(activeCards(resumed)) != 2 {
		t.Fatalf("resuming the note turned production back on: %+v", resumed.Cards)
	}
	again, err := f.svc.Practise(ctx, f.alice, n.ID, "explaining retrieval to a colleague", "")
	if err != nil {
		t.Fatal(err)
	}
	if c := activeCards(again)[vocab.KindProduction]; c.ID != prod.ID || c.Reps != 1 {
		t.Fatalf("production on again: %+v, want the same card with its review kept", c)
	}

	// A word not being learned cannot have one.
	skip := f.decide(t, ctx, "ability", vocab.DecisionSkip, map[string]string{"why": "w"}, "")
	if _, err := f.svc.Practise(ctx, f.alice, skip.ID, "a scenario", ""); !errors.Is(err, vocab.ErrInvalid) {
		t.Fatalf("production on a skipped word: %v", err)
	}
}

// Five to eight per cycle: the sixth to eighth "learn" of the learner's week
// brings up's guidance, the ninth the stronger notice. The week is Monday to
// Sunday in the learner's zone.
func TestVocabTheLearnCountIsTheLearnersLocalWeek(t *testing.T) {
	ctx, f := newVocabFixture(t)
	if _, err := pg.NewUserStore(f.pool).SetTimezone(ctx, f.alice, "Asia/Ho_Chi_Minh", false); err != nil {
		t.Fatal(err)
	}
	// Monday 2026-09-28 00:30 in Hanoi is Sunday 17:30 UTC.
	f.now = time.Date(2026, time.September, 27, 17, 30, 0, 0, time.UTC)
	terms := []string{"Crucially", "pre-trained", "access mechanisms", "ability", "access", "using", "present",
		"without", "additional", "training"}
	saved := make([]*vocab.Note, 0, len(terms))
	for _, term := range terms {
		saved = append(saved, f.decide(t, ctx, term, vocab.DecisionLearn, learnRecord, "m"))
	}
	// Two were decided late on Sunday, Hanoi time: last week.
	if _, err := f.pool.Exec(ctx, `UPDATE vocab_notes SET decided_at = $2 WHERE id = ANY($1)`,
		[]uuid.UUID{saved[0].ID, saved[1].ID}, time.Date(2026, time.September, 27, 16, 59, 0, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
	// One more was moved to skip, so it is no longer a word to learn.
	if _, err := f.svc.Update(ctx, f.alice, saved[2].ID, vocab.NotePatch{
		Decision: ptr(vocab.DecisionSkip), Record: map[string]string{"why": "w"}}); err != nil {
		t.Fatal(err)
	}
	week, err := f.svc.Week(ctx, f.alice)
	if err != nil {
		t.Fatal(err)
	}
	if week.Learning != 7 || week.Notice != vocab.NoticeSelect {
		t.Fatalf("week = %+v, want 7 and the guidance", week)
	}
	for n, want := range map[int]string{5: "", 6: vocab.NoticeSelect, 8: vocab.NoticeSelect, 9: vocab.NoticeOver, 12: vocab.NoticeOver} {
		if got := vocab.WeekNotice(n); got != want {
			t.Errorf("WeekNotice(%d) = %q, want %q", n, got, want)
		}
	}
	// Bob's count is his own.
	if w, _ := f.svc.Week(ctx, f.bob); w.Learning != 0 {
		t.Fatalf("Bob's week counts Alice's words: %+v", w)
	}
}

// The migration keeps every note saved before it as a word to learn, with
// its cards untouched, and decided when it was created.
func TestTheDecisionsMigrationKeepsExistingNotesAsLearn(t *testing.T) {
	ctx, f := newVocabFixture(t)
	down, err := os.ReadFile("../../../migrations/1790030000_vocab_decisions.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	up, err := os.ReadFile("../../../migrations/1790030000_vocab_decisions.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	tx, err := f.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, string(down)); err != nil {
		t.Fatalf("down: %v", err)
	}
	created := time.Date(2026, time.September, 1, 8, 0, 0, 0, time.UTC)
	var note uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO vocab_notes (user_id, term, lang, meaning, created_at, updated_at)
		VALUES ($1, 'equilibrium', 'en', 'a balanced state', $2, $2) RETURNING id`, f.alice, created).Scan(&note); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO vocab_cards (user_id, note_id, kind, due_at, reps)
		VALUES ($1, $2, 'recognition', $3, 4), ($1, $2, 'cloze', $3, 2)`, f.alice, note, created); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(up)); err != nil {
		t.Fatalf("up: %v", err)
	}
	var (
		decision string
		decided  time.Time
		record   string
		cards    int
		reps     int
	)
	if err := tx.QueryRow(ctx, `
		SELECT n.decision, n.decided_at, n.record::text,
		       (SELECT count(*) FROM vocab_cards c WHERE c.note_id = n.id AND NOT c.suspended),
		       (SELECT sum(reps) FROM vocab_cards c WHERE c.note_id = n.id)
		  FROM vocab_notes n WHERE n.id = $1`, note).Scan(&decision, &decided, &record, &cards, &reps); err != nil {
		t.Fatal(err)
	}
	if decision != "learn" || !decided.Equal(created) || record != "{}" || cards != 2 || reps != 6 {
		t.Fatalf("after the migration: %s, decided %v, record %s, %d active cards, %d reps", decision, decided, record, cards, reps)
	}
	// The widened kind CHECK takes a production card, the old one did not.
	if _, err := tx.Exec(ctx, `
		INSERT INTO vocab_cards (user_id, note_id, kind, due_at) VALUES ($1, $2, 'production', now())`, f.alice, note); err != nil {
		t.Fatalf("a production card: %v", err)
	}
}
