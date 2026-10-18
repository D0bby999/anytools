package pg_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning/loop"
)

// card seeds a card on a fresh state of user's.
func (f *loopFixture) card(t *testing.T, ctx context.Context, user uuid.UUID, kind string) *loop.SkillCard {
	t.Helper()
	st, _ := f.start(t, ctx, user, time.Now().UTC().Add(-time.Hour))
	c, err := f.store.CreateCard(ctx, loop.SkillCard{UserID: user, StateID: st.ID, Kind: kind, Title: "Explain FSRS",
		Setup: map[string]string{"situation": "s"}})
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	return c
}

func (f *loopFixture) entry(t *testing.T, ctx context.Context, user uuid.UUID, c *loop.SkillCard, tp string, ch loop.CardChange) {
	t.Helper()
	if _, err := f.store.AddCardEntry(ctx, user, c.ID, loop.CardEntry{Timepoint: tp, Body: tp + " body", PromptLevel: "unaided",
		Links: []loop.CardLink{}},
		func(loop.SkillCard) (*loop.CardChange, error) { return &ch, nil }); err != nil {
		t.Fatalf("AddCardEntry %s: %v", tp, err)
	}
}

func baselineChange(due string) loop.CardChange {
	at := time.Now().UTC()
	return loop.CardChange{Status: loop.CardRetestDue, BaselineAt: &at, RetestDueOn: due}
}

// TestCardKindsMatchTheMigration guards the kinds written twice.
func TestCardKindsMatchTheMigration(t *testing.T) {
	ctx, f := newLoopFixture(t)
	var def string
	if err := f.pool.QueryRow(ctx, `
		SELECT pg_get_constraintdef(oid) FROM pg_constraint
		 WHERE conrelid = 'skill_cards'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%kind%'`).Scan(&def); err != nil {
		t.Fatalf("read constraint: %v", err)
	}
	for _, k := range loop.CardKindNames() {
		if !strings.Contains(def, "'"+k+"'") {
			t.Errorf("kind %q is in Go but not in the CHECK: %s", k, def)
		}
	}
	if n := strings.Count(def, "::text"); n != len(loop.CardKindNames()) {
		t.Errorf("CHECK names %d kinds, Go names %d: %s", n, len(loop.CardKindNames()), def)
	}
}

// TestACardOwnsItsChainAndItsEntriesAreEvidence: creating a card creates its
// chain; each entry lands on that chain, accepted, at its own timepoint, so
// GateInputs counts it like any other chain ref.
func TestACardOwnsItsChainAndItsEntriesAreEvidence(t *testing.T) {
	ctx, f := newLoopFixture(t)
	c := f.card(t, ctx, f.alice, loop.CardReading)
	chain, err := f.store.GetChain(ctx, f.alice, c.ChainID)
	if err != nil || chain.StateID != c.StateID || chain.Question != c.Title {
		t.Fatalf("card chain = %+v, %v", chain, err)
	}
	f.entry(t, ctx, f.alice, c, loop.TimepointBaseline, baselineChange("2026-10-11"))

	refs, err := f.store.ListEvidence(ctx, f.alice, nil, &c.ChainID)
	if err != nil || len(refs) != 1 {
		t.Fatalf("chain refs = %+v, %v", refs, err)
	}
	r := refs[0]
	if r.Kind != loop.KindCardEntry || r.Timepoint != loop.TimepointBaseline || r.Status != loop.StatusAccepted {
		t.Fatalf("ref = %+v", r)
	}
	cyc, err := f.store.CurrentCycle(ctx, f.alice, c.StateID)
	if err != nil {
		t.Fatal(err)
	}
	in, _, err := f.store.GateInputs(ctx, f.alice, cyc.ID)
	if err != nil || len(in) != 1 || in[0].Timepoint != loop.TimepointBaseline {
		t.Fatalf("GateInputs = %+v, %v", in, err)
	}
	if tp, err := f.store.CardEntryTimepoint(ctx, f.alice, r.RefID); err != nil || tp != loop.TimepointBaseline {
		t.Fatalf("CardEntryTimepoint = %q, %v", tp, err)
	}
	if _, err := f.store.CardEntryTimepoint(ctx, f.bob, r.RefID); !errors.Is(err, loop.ErrNotFound) {
		t.Fatalf("bob reads alice's entry timepoint: %v", err)
	}
}

// TestTheSchemaKeepsOneBaselineAndNeverChangesAnEntry: the database refuses a
// second baseline and any UPDATE, whatever the Go code does.
func TestTheSchemaKeepsOneBaselineAndNeverChangesAnEntry(t *testing.T) {
	ctx, f := newLoopFixture(t)
	c := f.card(t, ctx, f.alice, loop.CardWriting)
	f.entry(t, ctx, f.alice, c, loop.TimepointBaseline, baselineChange("2026-10-11"))

	ch := baselineChange("2026-10-11")
	_, err := f.store.AddCardEntry(ctx, f.alice, c.ID, loop.CardEntry{Timepoint: "baseline", Body: "again", PromptLevel: "unaided",
		Links: []loop.CardLink{}}, func(loop.SkillCard) (*loop.CardChange, error) { return &ch, nil })
	if !errors.Is(err, loop.ErrConflict) {
		t.Fatalf("second baseline past the service: err = %v, want ErrConflict from the index", err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE card_entries SET body = 'rewritten' WHERE card_id = $1`, c.ID); err == nil ||
		!strings.Contains(err.Error(), "cannot be changed") {
		t.Fatalf("UPDATE of an entry: err = %v, want the trigger's refusal", err)
	}
}

// TestRetestsDueReadsTheDayItIsGiven: due today is listed, due tomorrow is not,
// and a card whose retest is done is not.
func TestRetestsDueReadsTheDayItIsGiven(t *testing.T) {
	ctx, f := newLoopFixture(t)
	today := f.card(t, ctx, f.alice, loop.CardSpeaking)
	f.entry(t, ctx, f.alice, today, loop.TimepointBaseline, baselineChange("2026-10-11"))
	tomorrow := f.card(t, ctx, f.alice, loop.CardSpeaking)
	f.entry(t, ctx, f.alice, tomorrow, loop.TimepointBaseline, baselineChange("2026-10-12"))
	done := f.card(t, ctx, f.alice, loop.CardSpeaking)
	f.entry(t, ctx, f.alice, done, loop.TimepointBaseline, baselineChange("2026-10-01"))
	f.entry(t, ctx, f.alice, done, loop.TimepointDelayed, loop.CardChange{Status: loop.CardOpen})

	due, err := f.store.RetestsDue(ctx, f.alice, "2026-10-11")
	if err != nil || len(due) != 1 || due[0].CardID != today.ID || due[0].RetestDueOn != "2026-10-11" {
		t.Fatalf("RetestsDue = %+v, %v", due, err)
	}
	if due, _ := f.store.RetestsDue(ctx, f.bob, "2026-10-11"); len(due) != 0 {
		t.Fatalf("bob sees alice's retests: %+v", due)
	}
}

// TestTheTargetQueryWithholdsAPendingBaseline is the renderer every chain,
// review, evidence and suggestion endpoint shares. Mutation-checked: returning
// left(c.body, 160) unconditionally fails it.
func TestTheTargetQueryWithholdsAPendingBaseline(t *testing.T) {
	ctx, f := newLoopFixture(t)
	c := f.card(t, ctx, f.alice, loop.CardListening)
	f.entry(t, ctx, f.alice, c, loop.TimepointBaseline, baselineChange("2026-10-11"))
	f.entry(t, ctx, f.alice, c, loop.TimepointImmediate, loop.CardChange{Status: loop.CardRetestDue})

	labels := func() map[string]*loop.Target {
		refs, err := f.store.ListEvidence(ctx, f.alice, nil, &c.ChainID)
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]*loop.Target{}
		for _, r := range refs {
			out[r.Timepoint] = r.Target
		}
		return out
	}
	got := labels()
	if b := got["baseline"]; b == nil || strings.Contains(b.Label, "baseline body") || !strings.Contains(b.Label, "hidden") {
		t.Fatalf("pending baseline rendered as %+v", b)
	}
	if b := got["baseline"]; b.Detail != "Explain FSRS · first attempt" || b.Link != "/loop/cards/"+c.ID.String() {
		t.Fatalf("baseline target = %+v", b)
	}
	if p := got["immediate"]; p == nil || p.Label != "immediate body" || p.Detail != "Explain FSRS · practice" {
		t.Fatalf("practice target = %+v", p)
	}
	// The suggestion query is the same SQL, narrowed by time.
	cands, err := f.store.Candidates(ctx, f.alice, c.StateID, time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	for _, cand := range cands {
		if strings.Contains(cand.Label, "baseline body") {
			t.Fatalf("suggestion shows the pending baseline: %+v", cand)
		}
	}

	f.entry(t, ctx, f.alice, c, loop.TimepointDelayed, loop.CardChange{Status: loop.CardOpen})
	if b := labels()["baseline"]; b.Label != "baseline body" {
		t.Fatalf("after the retest the baseline is still hidden: %+v", b)
	}
}

// TestCardLinksAreTheOwnersOnSaveAndOnRender: Alice's note in Bob's links is
// refused on save exactly as a nonexistent id; and a link to Alice's note
// planted straight into Bob's row renders as missing, with no label.
func TestCardLinksAreTheOwnersOnSaveAndOnRender(t *testing.T) {
	ctx, f := newLoopFixture(t)
	var aliceNote, aliceNB uuid.UUID
	if err := f.pool.QueryRow(ctx, `INSERT INTO notebooks (user_id, name) VALUES ($1, 'a') RETURNING id`, f.alice).Scan(&aliceNB); err != nil {
		t.Fatal(err)
	}
	if err := f.pool.QueryRow(ctx, `INSERT INTO notes (user_id, notebook_id, title, body_md) VALUES ($1, $2, 'Alice secret', 'x') RETURNING id`,
		f.alice, aliceNB).Scan(&aliceNote); err != nil {
		t.Fatal(err)
	}
	bobs := f.card(t, ctx, f.bob, loop.CardVocabulary)
	add := func(link uuid.UUID) error {
		ch := baselineChange("2026-10-11")
		_, err := f.store.AddCardEntry(ctx, f.bob, bobs.ID, loop.CardEntry{Timepoint: "baseline", Body: "b", PromptLevel: "unaided",
			Links: []loop.CardLink{{Kind: loop.LinkNote, ID: link}}},
			func(loop.SkillCard) (*loop.CardChange, error) { return &ch, nil })
		return err
	}
	if err := add(aliceNote); !errors.Is(err, loop.ErrNotFound) {
		t.Fatalf("alice's note in bob's links: err = %v, want ErrNotFound", err)
	}
	if err := add(uuid.New()); !errors.Is(err, loop.ErrNotFound) {
		t.Fatalf("a nonexistent note: err = %v, want ErrNotFound", err)
	}
	var n int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM card_entries WHERE card_id = $1`, bobs.ID).Scan(&n)
	if n != 0 {
		t.Fatalf("a refused entry was written (%d rows)", n)
	}

	// Render side: bypass the save check.
	if _, err := f.pool.Exec(ctx, `
		INSERT INTO card_entries (user_id, card_id, timepoint, body, links)
		VALUES ($1, $2, 'immediate', 'planted', jsonb_build_array(jsonb_build_object('kind', 'note', 'id', $3::text)))`,
		f.bob, bobs.ID, aliceNote); err != nil {
		t.Fatal(err)
	}
	entries, err := f.store.ListCardEntries(ctx, f.bob, bobs.ID)
	if err != nil || len(entries) != 1 || len(entries[0].Links) != 1 {
		t.Fatalf("entries = %+v, %v", entries, err)
	}
	if l := entries[0].Links[0]; !l.Missing || l.Label != "" || l.Path != "" {
		t.Fatalf("alice's note rendered on bob's card: %+v", l)
	}
}
