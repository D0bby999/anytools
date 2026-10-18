package pg_test

import (
	"context"
	"errors"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/account"
	"github.com/D0bby999/anytools/internal/learning/profile"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// profile_test.go — learning-depth phase 9: the learner's entries and the
// twelve-per-section cap, proposals that no prompt reads until accepted, refs
// resolved for the owner on save and on read, signals that carry no
// explain-back or document text, and account deletion.

var (
	_ profile.Store              = (*pg.ProfileStore)(nil)
	_ profile.PromptStore        = (*pg.ProfileStore)(nil)
	_ profile.ConsolidationStore = (*pg.ProfileStore)(nil)
)

type profileFixture struct {
	pool  *pgxpool.Pool
	store *pg.ProfileStore
	user  uuid.UUID
	kb    uuid.UUID
	path  uuid.UUID
	kp    uuid.UUID
	q     uuid.UUID
}

// newProfileFixture gives a fresh learner a knowledge base with a path, one
// knowledge point and one question on it.
func newProfileFixture(t *testing.T) (context.Context, *profileFixture) {
	t.Helper()
	ctx := context.Background()
	pool := testutil.TestDB(t)
	f := &profileFixture{pool: pool, store: pg.NewProfileStore(pool), user: testutil.NewUser(t, pool)}
	f.kb, f.path, f.kp, f.q = seedProfileKP(t, ctx, pool, f.user, "Parametric memory")
	return ctx, f
}

func seedProfileKP(t *testing.T, ctx context.Context, pool *pgxpool.Pool, user uuid.UUID, name string) (kb, path, kp, q uuid.UUID) {
	t.Helper()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	var module uuid.UUID
	must(pool.QueryRow(ctx, `INSERT INTO knowledge_bases (user_id, name) VALUES ($1, 'Retrieval papers') RETURNING id`, user).Scan(&kb))
	must(pool.QueryRow(ctx, `INSERT INTO mastery_paths (user_id, kb_id, goal) VALUES ($1, $2, 'g') RETURNING id`, user, kb).Scan(&path))
	must(pool.QueryRow(ctx, `INSERT INTO mastery_modules (user_id, path_id, ord, name) VALUES ($1, $2, 0, 'm') RETURNING id`, user, path).Scan(&module))
	must(pool.QueryRow(ctx, `INSERT INTO knowledge_points (user_id, module_id, name, type) VALUES ($1, $2, $3, 'concept') RETURNING id`,
		user, module, name).Scan(&kp))
	must(pool.QueryRow(ctx, `INSERT INTO questions (user_id, kb_id, knowledge_point_id, module_id, prompt, type, answer)
		VALUES ($1, $2, $3, $4, 'Where does parametric memory live?', 'short', 'weights') RETURNING id`,
		user, kb, kp, module).Scan(&q))
	return kb, path, kp, q
}

// answer records a quiz answer on the fixture's question, and a mistake for a
// wrong one.
func (f *profileFixture) answer(t *testing.T, ctx context.Context, correct bool, at time.Time) uuid.UUID {
	t.Helper()
	rating := "good"
	if !correct {
		rating = "again"
	}
	if _, err := f.pool.Exec(ctx, `INSERT INTO question_attempts (user_id, question_id, knowledge_point_id, user_answer, is_correct, rating, created_at)
		VALUES ($1, $2, $3, 'x', $4, $5, $6)`, f.user, f.q, f.kp, correct, rating, at); err != nil {
		t.Fatal(err)
	}
	if correct {
		return uuid.Nil
	}
	var id uuid.UUID
	if err := f.pool.QueryRow(ctx, `
		INSERT INTO error_records (user_id, question_id, kp_id, error_type, created_at, updated_at)
		VALUES ($1, $2, $3, 'recall', $4, $4)
		ON CONFLICT (user_id, question_id) WHERE status <> 'graduated' DO UPDATE SET updated_at = EXCLUDED.updated_at
		RETURNING id`, f.user, f.q, f.kp, at).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// propose stores proposals the way a successful run does.
func (f *profileFixture) propose(t *testing.T, ctx context.Context, props ...profile.Proposal) uuid.UUID {
	t.Helper()
	run, err := f.store.StartRun(ctx, f.user, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	var ops []profile.RunOp
	for _, p := range props {
		ops = append(ops, profile.RunOp{Op: p.Op, Section: p.Section, Text: p.Text, Status: profile.StatusProposed})
	}
	if err := f.store.FinishRun(ctx, f.user, run, profile.RunResult{Status: profile.RunSucceeded, Ops: ops, Proposals: props}, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	return run
}

func (f *profileFixture) byText(t *testing.T, ctx context.Context, text string) profile.Entry {
	t.Helper()
	entries, err := f.store.List(ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Text == text {
			return e
		}
	}
	t.Fatalf("no entry %q in %+v", text, entries)
	return profile.Entry{}
}

func TestProfileLearnerEntriesAndTheTwelvePerSectionCap(t *testing.T) {
	ctx, f := newProfileFixture(t)
	svc := profile.NewService(f.store, nil)
	for i := 0; i < profile.MaxPerSection; i++ {
		if _, err := svc.Add(ctx, f.user, "preferences", "Examples first, number "+string(rune('a'+i)), nil); err != nil {
			t.Fatalf("entry %d: %v", i, err)
		}
	}
	if _, err := svc.Add(ctx, f.user, "preferences", "One too many", nil); !errors.Is(err, profile.ErrSectionFull) {
		t.Fatalf("13th entry: %v, want ErrSectionFull", err)
	}
	// Another section has room.
	e, err := svc.Add(ctx, f.user, "struggles", "  Mixing up\nrecall and\trecognition  ", &f.kb)
	if err != nil {
		t.Fatal(err)
	}
	if e.Origin != profile.OriginLearner || e.Status != profile.StatusAccepted || e.Text != "Mixing up recall and recognition" ||
		e.KBID == nil || e.KBName != "Retrieval papers" || len(e.Refs) != 0 {
		t.Fatalf("learner entry = %+v", e)
	}
	if _, err := svc.Add(ctx, f.user, "secrets", "x", nil); !errors.Is(err, profile.ErrInvalid) {
		t.Errorf("unknown section: %v", err)
	}
	if _, err := svc.Add(ctx, f.user, "struggles", strings.Repeat("x", 281), nil); !errors.Is(err, profile.ErrInvalid) {
		t.Errorf("281 characters: %v", err)
	}

	// Another learner's knowledge base is the same 404 as none.
	bob := testutil.NewUser(t, f.pool)
	bobKB, _, _, _ := seedProfileKP(t, ctx, f.pool, bob, "b")
	if _, err := svc.Add(ctx, f.user, "struggles", "x", &bobKB); !errors.Is(err, profile.ErrNotFound) {
		t.Errorf("bob's knowledge base: %v", err)
	}
	if _, err := svc.Edit(ctx, f.user, e.ID, profile.EntryPatch{KBID: &bobKB}); !errors.Is(err, profile.ErrNotFound) {
		t.Errorf("edit to bob's knowledge base: %v", err)
	}
	// Moving an entry into a full section is refused too.
	full := "preferences"
	if _, err := svc.Edit(ctx, f.user, e.ID, profile.EntryPatch{Section: &full}); !errors.Is(err, profile.ErrSectionFull) {
		t.Errorf("move into a full section: %v", err)
	}
	cleared := uuid.Nil
	edited, err := svc.Edit(ctx, f.user, e.ID, profile.EntryPatch{KBID: &cleared})
	if err != nil || edited.KBID != nil {
		t.Fatalf("clear the knowledge base: %+v, %v", edited, err)
	}

	// Bob cannot touch Alice's entry by id.
	bobSvc := profile.NewService(f.store, nil)
	text := "stolen"
	if _, err := bobSvc.Edit(ctx, bob, e.ID, profile.EntryPatch{Text: &text}); !errors.Is(err, profile.ErrNotFound) {
		t.Errorf("bob edits alice's entry: %v", err)
	}
	if err := bobSvc.Delete(ctx, bob, e.ID); !errors.Is(err, profile.ErrNotFound) {
		t.Errorf("bob deletes alice's entry: %v", err)
	}
	if _, err := bobSvc.Accept(ctx, bob, e.ID); !errors.Is(err, profile.ErrNotFound) {
		t.Errorf("bob accepts alice's entry: %v", err)
	}

	if err := svc.Delete(ctx, f.user, e.ID); err != nil {
		t.Fatal(err)
	}
	n, err := svc.Clear(ctx, f.user)
	if err != nil || n != profile.MaxPerSection {
		t.Fatalf("clear removed %d, %v", n, err)
	}
	p, err := svc.Get(ctx, f.user)
	if err != nil || len(p.Entries) != 0 || p.Consolidation {
		t.Fatalf("after clear: %+v, %v", p, err)
	}
}

func TestProposalsAreNeverReadIntoPromptsUntilAccepted(t *testing.T) {
	ctx, f := newProfileFixture(t)
	kpRef := []profile.Ref{{Kind: profile.RefKnowledgePoint, ID: f.kp}}
	f.propose(t, ctx,
		profile.Proposal{Op: "add", Section: "preferences", Text: "Recent answers suggest worked examples help.", Refs: kpRef},
		profile.Proposal{Op: "add", Section: "struggles", Text: "Recall slips recur on this point.", Refs: kpRef, KBID: &f.kb},
	)
	svc := profile.NewService(f.store, nil)
	prompts := profile.NewPrompts(f.store)

	read := func(use profile.Use, kbs []uuid.UUID) string {
		t.Helper()
		note, err := prompts.Note(ctx, f.user, use, kbs)
		if err != nil {
			t.Fatal(err)
		}
		return note
	}
	if note := read(profile.UseMastery, []uuid.UUID{f.kb}); note != "" {
		t.Fatalf("proposals reached the mastery prompt:\n%s", note)
	}
	entries, err := f.store.PromptEntries(ctx, f.user, profile.Sections(), []uuid.UUID{f.kb})
	if err != nil || len(entries) != 0 {
		t.Fatalf("PromptEntries returned proposals: %+v, %v", entries, err)
	}

	pref := f.byText(t, ctx, "Recent answers suggest worked examples help.")
	struggle := f.byText(t, ctx, "Recall slips recur on this point.")
	if pref.Status != profile.StatusProposed || len(pref.Refs) != 1 || !pref.Refs[0].Exists || pref.Refs[0].Label != "Parametric memory" ||
		pref.Refs[0].ParentID == nil || *pref.Refs[0].ParentID != f.path {
		t.Fatalf("proposal as listed = %+v", pref)
	}
	if _, err := svc.Accept(ctx, f.user, pref.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Reject(ctx, f.user, struggle.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Accept(ctx, f.user, struggle.ID); !errors.Is(err, profile.ErrConflict) {
		t.Errorf("accepting a rejected proposal: %v", err)
	}
	if _, err := svc.Edit(ctx, f.user, struggle.ID, profile.EntryPatch{}); !errors.Is(err, profile.ErrConflict) {
		t.Errorf("editing a rejected proposal: %v", err)
	}

	note := read(profile.UseMastery, []uuid.UUID{f.kb})
	if !strings.Contains(note, "worked examples help") || strings.Contains(note, "Recall slips") {
		t.Fatalf("after accept/reject, the mastery note is:\n%s", note)
	}
	// A rejected proposal is not listed, but is remembered for the cooldown.
	list, _ := f.store.List(ctx, f.user)
	if len(list) != 1 {
		t.Errorf("list after reject = %+v", list)
	}
	cur, err := f.store.Current(ctx, f.user, time.Now())
	if err != nil || len(cur.Rejected) != 1 || len(cur.Consolidated) != 1 || cur.Accepted["preferences"] != 1 {
		t.Fatalf("current = %+v, %v", cur, err)
	}
}

func TestStruggleScopedToAnotherKnowledgeBaseIsNotRead(t *testing.T) {
	ctx, f := newProfileFixture(t)
	svc := profile.NewService(f.store, nil)
	var other uuid.UUID
	if err := f.pool.QueryRow(ctx, `INSERT INTO knowledge_bases (user_id, name) VALUES ($1, 'Chemistry') RETURNING id`, f.user).Scan(&other); err != nil {
		t.Fatal(err)
	}
	for _, e := range []struct {
		text string
		kb   *uuid.UUID
	}{{"Everywhere struggle", nil}, {"Retrieval struggle", &f.kb}, {"Chemistry struggle", &other}} {
		if _, err := svc.Add(ctx, f.user, "struggles", e.text, e.kb); err != nil {
			t.Fatal(err)
		}
	}
	note, err := profile.NewPrompts(f.store).Note(ctx, f.user, profile.UseMastery, []uuid.UUID{f.kb})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(note, "Everywhere struggle") || !strings.Contains(note, "Retrieval struggle") || strings.Contains(note, "Chemistry") {
		t.Fatalf("mastery note for the retrieval base:\n%s", note)
	}
}

func TestAcceptingAnUpdateOrARemoveChangesItsTarget(t *testing.T) {
	ctx, f := newProfileFixture(t)
	svc := profile.NewService(f.store, nil)
	kpRef := []profile.Ref{{Kind: profile.RefKnowledgePoint, ID: f.kp}}
	f.propose(t, ctx,
		profile.Proposal{Op: "add", Section: "struggles", Text: "First wording.", Refs: kpRef},
		profile.Proposal{Op: "add", Section: "strengths", Text: "Held up lately.", Refs: kpRef},
		profile.Proposal{Op: "add", Section: "studying", Text: "Mine soon.", Refs: kpRef},
	)
	target := f.byText(t, ctx, "First wording.")
	gone := f.byText(t, ctx, "Held up lately.")
	mine := f.byText(t, ctx, "Mine soon.")
	for _, e := range []profile.Entry{target, gone, mine} {
		if _, err := svc.Accept(ctx, f.user, e.ID); err != nil {
			t.Fatal(err)
		}
	}

	baseRef := []profile.Ref{{Kind: profile.RefKnowledgeBase, ID: f.kb}}
	f.propose(t, ctx,
		profile.Proposal{Op: "update", Section: "struggles", Text: "Second wording.", Refs: baseRef, ReplacesID: &target.ID},
		profile.Proposal{Op: "remove", Section: "strengths", Text: gone.Text, ReplacesID: &gone.ID},
		profile.Proposal{Op: "update", Section: "studying", Text: "Not yours any more.", Refs: kpRef, ReplacesID: &mine.ID},
	)
	up := f.byText(t, ctx, "Second wording.")
	if up.Op != "update" || up.ReplacesText != "First wording." {
		t.Fatalf("update proposal = %+v", up)
	}
	applied, err := svc.Accept(ctx, f.user, up.ID)
	if err != nil {
		t.Fatal(err)
	}
	if applied.ID != target.ID || applied.Text != "Second wording." || len(applied.Refs) != 1 || applied.Refs[0].Kind != profile.RefKnowledgeBase {
		t.Fatalf("applied update = %+v", applied)
	}

	// The learner makes "Mine soon." their own; the pending update of it is
	// withdrawn in the same transaction.
	text := "Mine now."
	if _, err := svc.Edit(ctx, f.user, mine.ID, profile.EntryPatch{Text: &text}); err != nil {
		t.Fatal(err)
	}
	var pending int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM profile_entries WHERE user_id = $1 AND replaces_id = $2`, f.user, mine.ID).Scan(&pending)
	if pending != 0 {
		t.Fatalf("%d proposals still target an entry the learner edited", pending)
	}

	// The remove: find the proposal row and accept it.
	var removeID uuid.UUID
	if err := f.pool.QueryRow(ctx, `SELECT id FROM profile_entries WHERE user_id = $1 AND op = 'remove'`, f.user).Scan(&removeID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Accept(ctx, f.user, removeID); err != nil {
		t.Fatal(err)
	}
	list, _ := f.store.List(ctx, f.user)
	var texts []string
	for _, e := range list {
		texts = append(texts, e.Origin+":"+e.Text)
	}
	slices.Sort(texts)
	if strings.Join(texts, "|") != "consolidated:Second wording.|learner:Mine now." {
		t.Fatalf("profile after accepting = %v", texts)
	}
}

// An update written before the learner made the target theirs — the
// proposal row exists, the target is now learner-origin — is refused at
// accept and withdrawn.
func TestAnUpdateOfAnEntryTheLearnerTookOverIsWithdrawn(t *testing.T) {
	ctx, f := newProfileFixture(t)
	svc := profile.NewService(f.store, nil)
	kpRef := []profile.Ref{{Kind: profile.RefKnowledgePoint, ID: f.kp}}
	f.propose(t, ctx, profile.Proposal{Op: "add", Section: "struggles", Text: "Original.", Refs: kpRef})
	orig := f.byText(t, ctx, "Original.")
	if _, err := svc.Accept(ctx, f.user, orig.ID); err != nil {
		t.Fatal(err)
	}
	f.propose(t, ctx, profile.Proposal{Op: "update", Section: "struggles", Text: "Rewritten.", Refs: kpRef, ReplacesID: &orig.ID})
	prop := f.byText(t, ctx, "Rewritten.")
	// Simulate the learner taking it over without the withdrawal (an older
	// server, a concurrent edit).
	if _, err := f.pool.Exec(ctx, `UPDATE profile_entries SET origin = 'learner' WHERE id = $1`, orig.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Accept(ctx, f.user, prop.ID); !errors.Is(err, profile.ErrConflict) {
		t.Fatalf("accepting an update of a learner entry: %v", err)
	}
	if got := f.byText(t, ctx, "Original."); got.Origin != profile.OriginLearner {
		t.Fatalf("target = %+v", got)
	}
	var n int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM profile_entries WHERE id = $1`, prop.ID).Scan(&n)
	if n != 0 {
		t.Error("the refused proposal was not withdrawn")
	}
}

// jsonb ids are resolved with the owner's user_id on save AND on read.
func TestRefsResolveForTheOwnerOnlyOnSaveAndOnRead(t *testing.T) {
	ctx, f := newProfileFixture(t)
	bob := testutil.NewUser(t, f.pool)
	_, _, bobKP, _ := seedProfileKP(t, ctx, f.pool, bob, "Bob's secret point")

	// On save: a proposal citing only Bob's point is not stored.
	run := f.propose(t, ctx,
		profile.Proposal{Op: "add", Section: "struggles", Text: "Cites a stranger.", Refs: []profile.Ref{{Kind: profile.RefKnowledgePoint, ID: bobKP}}},
		profile.Proposal{Op: "add", Section: "struggles", Text: "Cites both.", Refs: []profile.Ref{
			{Kind: profile.RefKnowledgePoint, ID: bobKP}, {Kind: profile.RefKnowledgePoint, ID: f.kp}}},
	)
	list, _ := f.store.List(ctx, f.user)
	if len(list) != 1 || list[0].Text != "Cites both." || len(list[0].Refs) != 1 || list[0].Refs[0].ID != f.kp {
		t.Fatalf("stored proposals = %+v", list)
	}
	r, err := f.store.Run(ctx, f.user, run)
	if err != nil || r.Ops[0].Status != "dropped" || r.Ops[0].Reason == "" || r.Ops[1].Status != profile.StatusProposed {
		t.Fatalf("run ops = %+v, %v", r, err)
	}
	if _, err := f.store.Run(ctx, bob, run); !errors.Is(err, profile.ErrNotFound) {
		t.Errorf("bob reads alice's run: %v", err)
	}

	// On read: a ref naming Bob's point that somehow got stored reads back
	// as nothing — no label, no parent.
	if _, err := f.pool.Exec(ctx, `UPDATE profile_entries SET refs = $2 WHERE id = $1`, list[0].ID,
		`[{"kind":"knowledge_point","id":"`+bobKP.String()+`"},{"kind":"skill_card","id":"`+uuid.NewString()+`"}]`); err != nil {
		t.Fatal(err)
	}
	got := f.byText(t, ctx, "Cites both.")
	for _, ref := range got.Refs {
		if ref.Exists || ref.Label != "" || ref.ParentID != nil {
			t.Errorf("a foreign or missing ref resolved: %+v", ref)
		}
	}
}

// Red team SF-3: an injection planted where a model's words live — an
// explain-back gap, misconception and feedback, the learner's explanation, a
// question and a vocabulary term — never reaches the consolidation input.
// The knowledge-point name reaches it, inside the envelope.
func TestAnInjectionPlantedAsAnExplainBackGapNeverReachesConsolidation(t *testing.T) {
	ctx, f := newProfileFixture(t)
	fixture, err := os.ReadFile("../../runtime/testdata/injection/write-note-persistence.txt")
	if err != nil {
		t.Fatal(err)
	}
	override, err := os.ReadFile("../../runtime/testdata/injection/direct-override.txt")
	if err != nil {
		t.Fatal(err)
	}
	gap := string(fixture)
	gaps := `["` + strings.ReplaceAll(strings.TrimSpace(gap), `'`, `’`) + `"]`
	if _, err := f.pool.Exec(ctx, `
		INSERT INTO explain_back_attempts (user_id, kp_id, path_id, request_id, explanation, verdict, gaps, misconceptions, feedback, judged_at)
		VALUES ($1, $2, $3, $4, $5, 'failed', $6::jsonb, $6::jsonb, $5, now())`,
		f.user, f.kp, f.path, uuid.New(), string(override), gaps); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE questions SET prompt = $2, answer = $2 WHERE id = $1`, f.q, strings.TrimSpace(gap)); err != nil {
		t.Fatal(err)
	}
	f.answer(t, ctx, false, time.Now())

	rows, err := f.store.SignalRows(ctx, f.user, time.Now().Add(-profile.SignalWindow))
	if err != nil {
		t.Fatal(err)
	}
	input := profile.Input(profile.BuildSignals(rows), nil)
	for _, leak := range []string{"without citing sources", "IMPORTANT", "maintenance mode", "Ignore all previous", "Where does"} {
		if strings.Contains(input, leak) {
			t.Fatalf("consolidation input carries %q:\n%s", leak, input)
		}
	}
	if !strings.Contains(input, `trust="untrusted">`+"\nParametric memory\n</document>") ||
		!strings.Contains(input, "explain-back passed 0, failed 1") || !strings.Contains(input, "recall 1") {
		t.Fatalf("the aggregates are missing:\n%s", input)
	}
}

func TestSignalsAreTheLearnersOwnAggregates(t *testing.T) {
	ctx, f := newProfileFixture(t)
	now := time.Now()
	mistake := f.answer(t, ctx, false, now.Add(-2*time.Hour))
	f.answer(t, ctx, true, now.Add(-time.Hour))
	// Old activity outside the window counts for nothing but open mistakes.
	f.answer(t, ctx, true, now.Add(-40*24*time.Hour))
	// Bob's activity on his own point is not Alice's.
	bob := testutil.NewUser(t, f.pool)
	_, _, _, bobQ := seedProfileKP(t, ctx, f.pool, bob, "Bob's point")
	if _, err := f.pool.Exec(ctx, `INSERT INTO question_attempts (user_id, question_id, user_answer, is_correct, rating)
		VALUES ($1, $2, 'x', false, 'again')`, bob, bobQ); err != nil {
		t.Fatal(err)
	}

	rows, err := f.store.SignalRows(ctx, f.user, now.Add(-profile.SignalWindow))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows.Points) != 1 || len(rows.Bases) != 1 {
		t.Fatalf("rows = %+v", rows)
	}
	p := rows.Points[0]
	if p.KnowledgePointID != f.kp || p.Attempts != 2 || p.Correct != 1 || p.OpenMistakes != 1 || p.MistakeID != mistake || p.Errors["recall"] != 1 {
		t.Fatalf("point = %+v", p)
	}
	if b := rows.Bases[0]; b.KnowledgeBaseID != f.kb || b.Attempts != 2 || b.Correct != 1 || b.OpenMistakes != 1 {
		t.Fatalf("base = %+v", b)
	}

	active, err := f.store.HasActivity(ctx, f.user, now.Add(-30*time.Minute))
	if err != nil || active {
		t.Fatalf("activity in the last half hour: %v, %v", active, err)
	}
	active, err = f.store.HasActivity(ctx, f.user, now.Add(-90*time.Minute))
	if err != nil || !active {
		t.Fatalf("activity in the last 90 minutes: %v, %v", active, err)
	}
}

type noFiles struct{}

func (noFiles) DeleteUser(context.Context, uuid.UUID) error { return nil }

func TestDeletingTheAccountRemovesTheProfileAndItsRuns(t *testing.T) {
	ctx, f := newProfileFixture(t)
	svc := profile.NewService(f.store, nil)
	if _, err := svc.Add(ctx, f.user, "preferences", "Examples first.", &f.kb); err != nil {
		t.Fatal(err)
	}
	f.propose(t, ctx, profile.Proposal{Op: "add", Section: "struggles", Text: "Recall slips.",
		Refs: []profile.Ref{{Kind: profile.RefKnowledgePoint, ID: f.kp}}})
	if err := svc.SetConsolidation(ctx, f.user, true); err != nil {
		t.Fatal(err)
	}

	if err := account.New(f.pool, noFiles{}, nil, nil).Delete(ctx, f.user); err != nil {
		t.Fatal(err)
	}
	var entries, runs int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM profile_entries WHERE user_id = $1`, f.user).Scan(&entries)
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM profile_runs WHERE user_id = $1`, f.user).Scan(&runs)
	if entries != 0 || runs != 0 {
		t.Fatalf("after account deletion: %d entries, %d runs", entries, runs)
	}
}

func TestTheProfileSectionsMatchTheMigration(t *testing.T) {
	raw, err := os.ReadFile("../../../migrations/1789850000_learner_profile.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	want := "('" + strings.Join(profile.Sections(), "', '") + "')"
	if !strings.Contains(strings.Join(strings.Fields(string(raw)), " "), want) {
		t.Fatalf("the section CHECK does not list %s", want)
	}
}
