package pg_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/learning/loop"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// loopFixture is two users over one store — always two, for the reason
// notebook_test.go gives: one user proves a query runs, not that it is scoped.
type loopFixture struct {
	pool  *pgxpool.Pool
	store *pg.LoopStore
	alice uuid.UUID
	bob   uuid.UUID
}

func newLoopFixture(t *testing.T) (context.Context, *loopFixture) {
	t.Helper()
	pool := testutil.TestDB(t)
	return context.Background(), &loopFixture{
		pool: pool, store: pg.NewLoopStore(pool),
		alice: testutil.NewUser(t, pool), bob: testutil.NewUser(t, pool),
	}
}

func (f *loopFixture) start(t *testing.T, ctx context.Context, user uuid.UUID, startedAt time.Time) (*loop.LearningState, *loop.Cycle) {
	t.Helper()
	st, c, err := f.store.CreateStateWithCycle(ctx, loop.LearningState{
		UserID: user, Goal: "Read Vietnamese news", RealScenario: "Morning paper",
		Outcome12w: "One article unaided", NextTask: "Ten words",
	}, startedAt)
	if err != nil {
		t.Fatalf("CreateStateWithCycle: %v", err)
	}
	return st, c
}

// attempt seeds one question and one attempt at it, returning the attempt id.
func (f *loopFixture) attempt(t *testing.T, ctx context.Context, user uuid.UUID, at time.Time) uuid.UUID {
	t.Helper()
	var kb, q, a uuid.UUID
	if err := f.pool.QueryRow(ctx,
		`INSERT INTO knowledge_bases (user_id, name) VALUES ($1, 'Loop KB') RETURNING id`, user).Scan(&kb); err != nil {
		t.Fatalf("seed kb: %v", err)
	}
	if err := f.pool.QueryRow(ctx, `
		INSERT INTO questions (user_id, kb_id, prompt, type, answer)
		VALUES ($1, $2, 'What does "báo" mean?', 'short', 'newspaper') RETURNING id`, user, kb).Scan(&q); err != nil {
		t.Fatalf("seed question: %v", err)
	}
	if err := f.pool.QueryRow(ctx, `
		INSERT INTO question_attempts (user_id, question_id, user_answer, is_correct, rating, created_at)
		VALUES ($1, $2, 'newspaper', true, 'good', $3) RETURNING id`, user, q, at).Scan(&a); err != nil {
		t.Fatalf("seed attempt: %v", err)
	}
	return a
}

func TestLoopStateAndCycleRoundTrip(t *testing.T) {
	ctx, f := newLoopFixture(t)
	st, c := f.start(t, ctx, f.alice, time.Now().UTC())
	if c.Phase != loop.PhaseCalibrate || c.StateID != st.ID {
		t.Fatalf("first cycle = %+v", c)
	}
	if st.AIBoundaries.AIMay == nil || st.Hypotheses == nil {
		t.Fatal("empty lists must decode as [], not null")
	}

	hyps := []loop.Hypothesis{{Claim: "Flashcards before bed", Source: loop.HypothesisFromUser}}
	next := "Twenty words"
	up, err := f.store.UpdateState(ctx, f.alice, st.ID, loop.StatePatch{Hypotheses: &hyps, NextTask: &next})
	if err != nil {
		t.Fatalf("UpdateState: %v", err)
	}
	if len(up.Hypotheses) != 1 || up.NextTask != next || up.Goal != st.Goal {
		t.Fatalf("patched state = %+v", up)
	}
	if !up.UpdatedAt.After(st.UpdatedAt) || loop.Revision(*up) == loop.Revision(*st) {
		t.Fatal("an update must change the revision a paste-back is checked against")
	}

	list, err := f.store.ListStates(ctx, f.alice)
	if err != nil || len(list) != 1 || list[0].Phase != loop.PhaseCalibrate || list[0].CycleID == nil {
		t.Fatalf("ListStates = %+v, %v", list, err)
	}

	st2, cyc, err := f.store.RecordInterruption(ctx, f.alice, st.ID, "Five words", "Five words",
		loop.Interruption{At: time.Now().UTC(), Note: "Sick", PriorTask: next})
	if err != nil {
		t.Fatalf("RecordInterruption: %v", err)
	}
	if st2.NextTask != "Five words" || len(cyc.Interruptions) != 1 || cyc.Interruptions[0].PriorTask != next {
		t.Fatalf("interruption: state %+v cycle %+v", st2, cyc)
	}
}

// TestLoopStoreIsScopedToTheOwner: every read and write that names an id
// answers ErrNotFound for another user's row, and a child cannot be attached
// under another user's parent.
func TestLoopStoreIsScopedToTheOwner(t *testing.T) {
	ctx, f := newLoopFixture(t)
	st, c := f.start(t, ctx, f.alice, time.Now().UTC())
	review, err := f.store.CreateReview(ctx, f.alice, c.ID, 1)
	if err != nil {
		t.Fatalf("CreateReview: %v", err)
	}
	chain, err := f.store.CreateChain(ctx, loop.Chain{UserID: f.alice, StateID: st.ID, Question: "Can I read a headline?"})
	if err != nil {
		t.Fatalf("CreateChain: %v", err)
	}
	brief, err := f.store.CreateBrief(ctx, loop.Brief{UserID: f.alice, StateID: st.ID, Task: "Summarise", PreStartCheck: map[string]bool{}})
	if err != nil {
		t.Fatalf("CreateBrief: %v", err)
	}
	lg, err := f.store.CreateLog(ctx, loop.Log{UserID: f.alice, BriefID: brief.ID})
	if err != nil {
		t.Fatalf("CreateLog: %v", err)
	}

	bob := f.bob
	notFound := map[string]error{}
	_, notFound["GetState"] = f.store.GetState(ctx, bob, st.ID)
	_, notFound["UpdateState"] = f.store.UpdateState(ctx, bob, st.ID, loop.StatePatch{})
	notFound["DeleteState"] = f.store.DeleteState(ctx, bob, st.ID)
	_, _, notFound["RecordInterruption"] = f.store.RecordInterruption(ctx, bob, st.ID, "x", "x", loop.Interruption{})
	_, notFound["GetCycle"] = f.store.GetCycle(ctx, bob, c.ID)
	_, notFound["CurrentCycle"] = f.store.CurrentCycle(ctx, bob, st.ID)
	_, notFound["CreateCycle"] = f.store.CreateCycle(ctx, bob, st.ID, time.Now())
	_, notFound["UpdateCycle"] = f.store.UpdateCycle(ctx, bob, c.ID, loop.CyclePatch{})
	_, notFound["CreateReview"] = f.store.CreateReview(ctx, bob, c.ID, 2)
	_, notFound["GetReview"] = f.store.GetReview(ctx, bob, review.ID)
	_, notFound["UpdateReview"] = f.store.UpdateReview(ctx, bob, review.ID, loop.ReviewPatch{})
	_, notFound["GetChain"] = f.store.GetChain(ctx, bob, chain.ID)
	notFound["DeleteChain"] = f.store.DeleteChain(ctx, bob, chain.ID)
	_, notFound["CreateChain"] = f.store.CreateChain(ctx, loop.Chain{UserID: bob, StateID: st.ID, Question: "x"})
	_, notFound["GetBrief"] = f.store.GetBrief(ctx, bob, brief.ID)
	_, notFound["CreateBrief"] = f.store.CreateBrief(ctx, loop.Brief{UserID: bob, StateID: st.ID, Task: "x"})
	_, notFound["GetLog"] = f.store.GetLog(ctx, bob, lg.ID)
	_, notFound["CreateLog"] = f.store.CreateLog(ctx, loop.Log{UserID: bob, BriefID: brief.ID})
	notFound["DeleteLog"] = f.store.DeleteLog(ctx, bob, lg.ID)
	_, notFound["AddEvidence"] = f.store.AddEvidence(ctx, loop.EvidenceRef{
		UserID: bob, ReviewID: &review.ID, Kind: loop.KindNote, RefID: uuid.New(),
		Status: loop.StatusAccepted, SuggestedBy: loop.SuggestedByUser,
	})
	for name, err := range notFound {
		if !errors.Is(err, loop.ErrNotFound) {
			t.Errorf("bob %s on alice's row: err = %v, want ErrNotFound", name, err)
		}
	}

	if list, _ := f.store.ListStates(ctx, bob); len(list) != 0 {
		t.Errorf("bob lists %d of alice's states", len(list))
	}
	if list, _ := f.store.ListReviews(ctx, bob, c.ID); len(list) != 0 {
		t.Errorf("bob lists %d of alice's reviews", len(list))
	}
	if refs, _, _ := f.store.GateInputs(ctx, bob, c.ID); len(refs) != 0 {
		t.Errorf("bob reads alice's gate inputs")
	}

	// Ownership of an evidence TARGET is checked by kind.
	aliceAttempt := f.attempt(t, ctx, f.alice, time.Now())
	if ok, _ := f.store.OwnsTarget(ctx, f.alice, loop.KindQuestionAttempt, aliceAttempt); !ok {
		t.Error("alice does not own her own attempt")
	}
	if ok, _ := f.store.OwnsTarget(ctx, bob, loop.KindQuestionAttempt, aliceAttempt); ok {
		t.Error("bob owns alice's attempt")
	}
	if ok, _ := f.store.OwnsTarget(ctx, f.alice, loop.KindResearchReport, uuid.New()); ok {
		t.Error("a research report was attachable before phase 9 exists")
	}
}
