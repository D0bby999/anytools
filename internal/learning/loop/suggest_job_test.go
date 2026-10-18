package loop_test

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning/loop"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// blockingSource holds the first runner inside the lock until released.
type blockingSource struct {
	entered chan struct{}
	release chan struct{}
	calls   atomic.Int32
}

func (s *blockingSource) ActiveCycles(context.Context) ([]loop.ActiveCycle, error) {
	if s.calls.Add(1) == 1 {
		close(s.entered)
		<-s.release
	}
	return nil, nil
}

func (s *blockingSource) EnsureReview(context.Context, uuid.UUID, uuid.UUID, int) (uuid.UUID, error) {
	return uuid.Nil, nil
}

func (s *blockingSource) Candidates(context.Context, uuid.UUID, uuid.UUID, time.Time, time.Time) ([]loop.Candidate, error) {
	return nil, nil
}

func (s *blockingSource) InsertSuggestion(context.Context, uuid.UUID, uuid.UUID, loop.Candidate) (bool, error) {
	return false, nil
}

// TestTwoSuggestRunnersRunOnce: while one runner holds the advisory lock, a
// second skips instead of running the pass again.
func TestTwoSuggestRunnersRunOnce(t *testing.T) {
	pool := testutil.TestDB(t)
	source := &blockingSource{entered: make(chan struct{}), release: make(chan struct{})}
	first := loop.NewSuggestJob(pool, source)
	second := loop.NewSuggestJob(pool, source)

	done := make(chan error, 1)
	go func() {
		_, ran, err := first.RunOnce(context.Background())
		if err == nil && !ran {
			t.Error("the first runner did not get the lock")
		}
		done <- err
	}()
	<-source.entered

	_, ran, err := second.RunOnce(context.Background())
	if err != nil || ran {
		t.Fatalf("second runner ran=%v err=%v while the first held the lock", ran, err)
	}
	close(source.release)
	if err := <-done; err != nil {
		t.Fatalf("first runner: %v", err)
	}
	if got := source.calls.Load(); got != 1 {
		t.Fatalf("pass ran %d times, want 1", got)
	}
}

// TestSuggestJobProposesThisWeeksWorkOnceAndRespectsDismissals runs the real
// pass against the real store: an attempt made this week becomes a suggested
// ref on this week's review; a second night adds nothing; a dismissed
// suggestion stays dismissed.
func TestSuggestJobProposesThisWeeksWorkOnceAndRespectsDismissals(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	store := pg.NewLoopStore(pool)
	user := testutil.NewUser(t, pool)
	now := time.Now().UTC()

	_, cycle, err := store.CreateStateWithCycle(ctx, loop.LearningState{
		UserID: user, Goal: "Job goal", RealScenario: "s", Outcome12w: "o", NextTask: "t",
	}, now.Add(-time.Hour))
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	var kb, q, attempt uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO knowledge_bases (user_id, name) VALUES ($1, 'k') RETURNING id`, user).Scan(&kb); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO questions (user_id, kb_id, prompt, type, answer)
		VALUES ($1, $2, 'p', 'short', 'a') RETURNING id`, user, kb).Scan(&q); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO question_attempts (user_id, question_id, is_correct, rating)
		VALUES ($1, $2, false, 'again') RETURNING id`, user, q).Scan(&attempt); err != nil {
		t.Fatal(err)
	}

	job := loop.NewSuggestJob(pool, store)
	job.SetClock(func() time.Time { return now })
	run := func() {
		t.Helper()
		if _, ran, err := job.RunOnce(ctx); err != nil || !ran {
			t.Fatalf("RunOnce ran=%v err=%v", ran, err)
		}
	}
	run()

	reviews, _ := store.ListReviews(ctx, user, cycle.ID)
	if len(reviews) != 1 || reviews[0].WeekNo != 1 {
		t.Fatalf("reviews = %+v, want week 1 created by the job", reviews)
	}
	refs, _ := store.ListEvidence(ctx, user, &reviews[0].ID, nil)
	if len(refs) != 1 || refs[0].RefID != attempt || refs[0].Status != loop.StatusSuggested ||
		refs[0].SuggestedBy != loop.SuggestedByJob || refs[0].Timepoint != loop.TimepointBaseline {
		t.Fatalf("refs after first night = %+v", refs)
	}

	dismissed := loop.StatusDismissed
	if _, err := store.UpdateEvidence(ctx, user, refs[0].ID, loop.EvidencePatch{Status: &dismissed}); err != nil {
		t.Fatalf("dismiss: %v", err)
	}
	run()
	refs, _ = store.ListEvidence(ctx, user, &reviews[0].ID, nil)
	if len(refs) != 1 || refs[0].Status != loop.StatusDismissed {
		t.Fatalf("refs after second night = %+v, want the one dismissed ref", refs)
	}

	// A suggestion never opens a gate.
	gateRefs, written, _ := store.GateInputs(ctx, user, cycle.ID)
	if g := loop.EvaluateGate(loop.GateInput{Phase: cycle.Phase, Refs: gateRefs, WrittenBackReviews: written}); g.Open {
		t.Fatal("the job's suggestions opened a gate")
	}
}
