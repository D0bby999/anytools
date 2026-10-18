package pg_test

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/research"
	"github.com/D0bby999/anytools/internal/learning/loop"
	"github.com/D0bby999/anytools/internal/store/pg"
)

func intp(n int) *int { return &n }

// TestEvidenceAcceptIsIdempotentAndResolvesItsTarget: accepting the same
// target twice is one row, and a ref shows what it points at.
func TestEvidenceAcceptIsIdempotentAndResolvesItsTarget(t *testing.T) {
	ctx, f := newLoopFixture(t)
	_, c := f.start(t, ctx, f.alice, time.Now().UTC().Add(-time.Hour))
	review, err := f.store.CreateReview(ctx, f.alice, c.ID, 1)
	if err != nil {
		t.Fatalf("CreateReview: %v", err)
	}
	if _, err := f.store.CreateReview(ctx, f.alice, c.ID, 1); !errors.Is(err, loop.ErrConflict) {
		t.Fatalf("second review for week 1: err = %v, want ErrConflict", err)
	}
	a := f.attempt(t, ctx, f.alice, time.Now())

	add := func(status, tp string) *loop.EvidenceRef {
		ref, err := f.store.AddEvidence(ctx, loop.EvidenceRef{
			UserID: f.alice, ReviewID: &review.ID, Kind: loop.KindQuestionAttempt, RefID: a,
			Timepoint: tp, Status: status, SuggestedBy: loop.SuggestedByJob,
		})
		if err != nil {
			t.Fatalf("AddEvidence: %v", err)
		}
		return ref
	}
	first := add(loop.StatusSuggested, loop.TimepointBaseline)
	second := add(loop.StatusAccepted, "")
	if first.ID != second.ID || second.Status != loop.StatusAccepted || second.Timepoint != loop.TimepointBaseline {
		t.Fatalf("accept upsert: first %+v second %+v", first, second)
	}
	if second.Target == nil || second.Target.Detail != "Answered correctly" || second.Target.Link != "/quiz/bank" {
		t.Fatalf("target = %+v", second.Target)
	}

	refs, _, err := f.store.GateInputs(ctx, f.alice, c.ID)
	if err != nil || len(refs) != 1 || refs[0].Timepoint != loop.TimepointBaseline {
		t.Fatalf("GateInputs = %+v, %v", refs, err)
	}

	// The candidate query sees the attempt in the window, and the hint reads
	// a first attempt as a baseline.
	cands, err := f.store.Candidates(ctx, f.alice, c.StateID, c.StartedAt, c.StartedAt.Add(7*24*time.Hour))
	if err != nil {
		t.Fatalf("Candidates: %v", err)
	}
	if len(cands) != 1 || cands[0].RefID != a || cands[0].Timepoint != loop.TimepointBaseline {
		t.Fatalf("candidates = %+v", cands)
	}
	if other, _ := f.store.Candidates(ctx, f.bob, c.StateID, c.StartedAt, c.StartedAt.Add(7*24*time.Hour)); len(other) != 0 {
		t.Fatalf("bob's candidates include alice's work: %+v", other)
	}
}

// TestWritebackAppendsOnceAndFreezesTheReview.
func TestWritebackAppendsOnceAndFreezesTheReview(t *testing.T) {
	ctx, f := newLoopFixture(t)
	st, c := f.start(t, ctx, f.alice, time.Now().UTC())
	review, _ := f.store.CreateReview(ctx, f.alice, c.ID, 1)

	// Not ready: nothing scored, no evidence.
	_, _, err := f.store.ApplyWriteback(ctx, f.alice, review.ID, loop.PlanWriteback)
	var nr *loop.NotReadyError
	if !errors.As(err, &nr) || len(nr.Problems) == 0 {
		t.Fatalf("writeback of an empty review: err = %v, want NotReadyError", err)
	}

	change := "Read before breakfast instead of after"
	if _, err := f.store.UpdateReview(ctx, f.alice, review.ID, loop.ReviewPatch{
		Completion: intp(2), Quality: intp(1), Retention: intp(1), Transfer: intp(1),
		OneVariableChange: &change,
	}); err != nil {
		t.Fatalf("UpdateReview: %v", err)
	}
	a := f.attempt(t, ctx, f.alice, time.Now())
	if _, err := f.store.AddEvidence(ctx, loop.EvidenceRef{
		UserID: f.alice, ReviewID: &review.ID, Kind: loop.KindQuestionAttempt, RefID: a,
		Status: loop.StatusAccepted, SuggestedBy: loop.SuggestedByUser,
	}); err != nil {
		t.Fatalf("AddEvidence: %v", err)
	}

	done, updated, err := f.store.ApplyWriteback(ctx, f.alice, review.ID, loop.PlanWriteback)
	if err != nil {
		t.Fatalf("ApplyWriteback: %v", err)
	}
	if !done.WritebackDone || len(updated.Hypotheses) != len(st.Hypotheses)+1 ||
		updated.Hypotheses[0].Claim != change {
		t.Fatalf("after writeback: review %+v state hypotheses %+v", done, updated.Hypotheses)
	}
	if _, _, err := f.store.ApplyWriteback(ctx, f.alice, review.ID, loop.PlanWriteback); !errors.As(err, &nr) {
		t.Fatalf("second writeback: err = %v, want NotReadyError", err)
	}
	if _, err := f.store.UpdateReview(ctx, f.alice, review.ID, loop.ReviewPatch{Quality: intp(2)}); !errors.Is(err, loop.ErrConflict) {
		t.Fatalf("editing a written-back review: err = %v, want ErrConflict", err)
	}
	if _, n, _ := f.store.GateInputs(ctx, f.alice, c.ID); n != 1 {
		t.Fatalf("written-back reviews = %d, want 1", n)
	}
}

// TestAdvanceIsCompareAndSet: an advance from a phase the cycle has already
// left is refused rather than stepping twice.
func TestAdvanceIsCompareAndSet(t *testing.T) {
	ctx, f := newLoopFixture(t)
	_, c := f.start(t, ctx, f.alice, time.Now().UTC())
	rec := loop.GateRecord{From: loop.PhaseCalibrate, To: loop.PhaseStack, At: time.Now().UTC()}
	moved, err := f.store.AdvanceCycle(ctx, f.alice, c.ID, rec)
	if err != nil || moved.Phase != loop.PhaseStack || len(moved.GateEvidence) != 1 {
		t.Fatalf("AdvanceCycle = %+v, %v", moved, err)
	}
	if _, err := f.store.AdvanceCycle(ctx, f.alice, c.ID, rec); !errors.Is(err, loop.ErrConflict) {
		t.Fatalf("stale advance: err = %v, want ErrConflict", err)
	}
}

// TestEvidenceKindsMatchTheMigration guards the list written twice: in Go
// and as a CHECK constraint.
func TestEvidenceKindsMatchTheMigration(t *testing.T) {
	ctx, f := newLoopFixture(t)
	var def string
	if err := f.pool.QueryRow(ctx, `
		SELECT pg_get_constraintdef(oid) FROM pg_constraint
		 WHERE conrelid = 'evidence_refs'::regclass AND conname = 'evidence_refs_kind_check'`).Scan(&def); err != nil {
		t.Fatalf("read constraint: %v", err)
	}
	for _, k := range loop.EvidenceKinds() {
		if !strings.Contains(def, "'"+k+"'") {
			t.Errorf("kind %q is in Go but not in the CHECK: %s", k, def)
		}
	}
	// Each listed value renders as '<kind>'::text.
	if n := strings.Count(def, "::text"); n != len(loop.EvidenceKinds()) {
		t.Errorf("CHECK names %d kinds, Go names %d: %s", n, len(loop.EvidenceKinds()), def)
	}
}

// A research report (phase 9) is evidence like any other: its owner can attach
// it, it is proposed for the week it was written in, and it resolves to a link
// back to the report. Nobody else can attach it.
func TestAResearchReportIsEvidenceForItsOwnerOnly(t *testing.T) {
	ctx, f := newLoopFixture(t)
	_, c := f.start(t, ctx, f.alice, time.Now().UTC().Add(-time.Hour))

	rep, err := pg.NewResearchStore(f.pool).InsertReport(ctx, research.Report{
		UserID: f.alice, Query: "How does RAG work?", Mode: "quick", ReportMD: "r",
		KBOnly: true, KBOnlyReason: "no_search_key",
	})
	if err != nil {
		t.Fatalf("InsertReport: %v", err)
	}

	if ok, err := f.store.OwnsTarget(ctx, f.alice, loop.KindResearchReport, rep.ID); err != nil || !ok {
		t.Fatalf("owner: OwnsTarget = %v, %v", ok, err)
	}
	if ok, _ := f.store.OwnsTarget(ctx, f.bob, loop.KindResearchReport, rep.ID); ok {
		t.Fatal("another user can attach alice's report as evidence")
	}

	cands, err := f.store.Candidates(ctx, f.alice, c.StateID, c.StartedAt, time.Now().UTC().Add(time.Hour))
	if err != nil {
		t.Fatalf("Candidates: %v", err)
	}
	var found *loop.Candidate
	for i := range cands {
		if cands[i].RefID == rep.ID {
			found = &cands[i]
		}
	}
	if found == nil || found.Kind != loop.KindResearchReport || !strings.HasPrefix(found.Link, "/research/") {
		t.Fatalf("the report is not proposed, or does not link back: %+v", cands)
	}
}

// The two kinds the learning-depth groundwork added (explain_back, card_entry)
// attach through AddEvidence for their owner, resolve to a target, and are
// refused to anyone else. Before the groundwork both failed closed for
// everyone, which an isolation probe alone cannot tell apart from working.
func TestTheGroundworkEvidenceKindsAttachForTheirOwnerOnly(t *testing.T) {
	ctx, f := newLoopFixture(t)
	_, c := f.start(t, ctx, f.alice, time.Now().UTC().Add(-time.Hour))
	review, err := f.store.CreateReview(ctx, f.alice, c.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	// Both stubs have their columns now: an explain-back needs its point and
	// path (phase 2), a card entry its card (phase 8).
	seed := map[string]func() uuid.UUID{
		loop.KindExplainBack: func() uuid.UUID {
			id, _, _ := seedExplainBack(t, ctx, f.pool, f.alice)
			return id
		},
		loop.KindCardEntry: func() uuid.UUID {
			card := f.card(t, ctx, f.alice, loop.CardWriting)
			f.entry(t, ctx, f.alice, card, loop.TimepointImmediate, loop.CardChange{Status: loop.CardOpen})
			var id uuid.UUID
			if err := f.pool.QueryRow(ctx, `SELECT id FROM card_entries WHERE card_id = $1`, card.ID).Scan(&id); err != nil {
				t.Fatal(err)
			}
			return id
		},
	}
	for kind, seedRow := range seed {
		id := seedRow()
		if ok, err := f.store.OwnsTarget(ctx, f.alice, kind, id); err != nil || !ok {
			t.Fatalf("%s: owner's OwnsTarget = %v, %v", kind, ok, err)
		}
		if ok, _ := f.store.OwnsTarget(ctx, f.bob, kind, id); ok {
			t.Fatalf("%s: another user owns alice's row", kind)
		}
		ref, err := f.store.AddEvidence(ctx, loop.EvidenceRef{UserID: f.alice, ReviewID: &review.ID,
			Kind: kind, RefID: id, Status: loop.StatusAccepted, SuggestedBy: loop.SuggestedByUser})
		if err != nil {
			t.Fatalf("%s: AddEvidence: %v", kind, err)
		}
		if ref.Target == nil || ref.Target.Label == "" {
			t.Fatalf("%s: the ref resolves to no target: %+v", kind, ref)
		}
	}
	cands, err := f.store.Candidates(ctx, f.alice, c.StateID, c.StartedAt, time.Now().UTC().Add(time.Hour))
	if err != nil {
		t.Fatalf("Candidates: %v", err)
	}
	seen := map[string]bool{}
	for _, cand := range cands {
		seen[cand.Kind] = true
	}
	if !seen[loop.KindExplainBack] || !seen[loop.KindCardEntry] {
		t.Fatalf("the week's suggestions miss a new kind: %v", seen)
	}
}
