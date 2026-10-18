package jobs_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/testutil"
)

// SF-14: a job that fails on unit 3 of 5 resumes at unit 3 on its retry, and
// the units already paid for are never called again.
func TestRunUnitsResumesAtTheFirstUnfinishedUnit(t *testing.T) {
	pool := testutil.TestDB(t)
	user := makeUser(t, pool)
	q := jobs.NewQueue(pool, time.Minute)
	ctx := context.Background()
	kind := "units_" + uuid.NewString()
	id, err := q.Enqueue(ctx, user, kind, payload{}, 2)
	if err != nil {
		t.Fatal(err)
	}

	calls := map[int]int{}
	failAt := 2 // the third unit, zero-based
	run := func() error {
		job, err := q.Claim(ctx, "w", []string{kind})
		if err != nil {
			t.Fatalf("claim: %v", err)
		}
		return q.RunUnits(ctx, job, 5, func(_ context.Context, i int) (int, error) {
			calls[i]++
			if i == failAt {
				failAt = -1
				return 1, errors.New("provider timed out")
			}
			return 1, nil
		})
	}

	if err := run(); err == nil {
		t.Fatal("first attempt should fail at unit 3")
	}
	if _, err := q.Fail(ctx, id, "w", errors.New("x"), false); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE jobs SET run_after = now() WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if err := run(); err != nil {
		t.Fatalf("retry: %v", err)
	}
	for i := 0; i < 5; i++ {
		want := 1
		if i == 2 {
			want = 2 // failed once, then succeeded on the retry
		}
		if calls[i] != want {
			t.Errorf("unit %d ran %d times, want %d", i, calls[i], want)
		}
	}
	job, _ := q.Get(ctx, id)
	p := jobs.ProgressOf(job)
	if p.Done != 5 || p.Total != 5 || p.Billed != 6 {
		t.Fatalf("progress = %+v, want done 5 of 5 with 6 billed calls (the failed one counts)", p)
	}
}

// A cancel stops the job after the unit in flight, as a terminal failure, and
// only the job's owner can ask.
func TestCancelStopsAfterTheCurrentUnit(t *testing.T) {
	pool := testutil.TestDB(t)
	alice, bob := makeUser(t, pool), makeUser(t, pool)
	q := jobs.NewQueue(pool, time.Minute)
	ctx := context.Background()
	kind := "units_" + uuid.NewString()
	id, err := q.Enqueue(ctx, alice, kind, payload{}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := q.RequestCancel(ctx, bob, id); err != nil || ok {
		t.Fatalf("another user's cancel = %v, %v; want refused", ok, err)
	}

	job, err := q.Claim(ctx, "w", []string{kind})
	if err != nil {
		t.Fatal(err)
	}
	ran := []int{}
	err = q.RunUnits(ctx, job, 5, func(ctx context.Context, i int) (int, error) {
		ran = append(ran, i)
		if i == 1 {
			// The learner presses Cancel while unit 1 is being synthesised.
			if ok, err := q.RequestCancel(ctx, alice, id); err != nil || !ok {
				t.Fatalf("owner's cancel = %v, %v", ok, err)
			}
		}
		return 1, nil
	})
	if !errors.Is(err, jobs.ErrCancelled) {
		t.Fatalf("err = %v, want ErrCancelled", err)
	}
	var terminal *jobs.TerminalError
	if !errors.As(err, &terminal) {
		t.Fatalf("a cancel must be terminal, or the job is retried: %v", err)
	}
	if len(ran) != 2 {
		t.Fatalf("units run = %v, want [0 1]: the unit in flight finishes, no new one starts", ran)
	}
	// A finished job cannot be cancelled.
	if err := q.Complete(ctx, id, "w"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := q.RequestCancel(ctx, alice, id); ok {
		t.Fatal("cancelled a finished job")
	}
}

// A reaped job's checkpoint belongs to its new holder: the old worker's write
// is refused, and it learns to stop.
func TestAReapedJobRefusesTheOldWorkersCheckpoint(t *testing.T) {
	pool := testutil.TestDB(t)
	user := makeUser(t, pool)
	q := jobs.NewQueue(pool, time.Minute)
	ctx := context.Background()
	kind := "units_" + uuid.NewString()
	id, err := q.Enqueue(ctx, user, kind, payload{}, 3)
	if err != nil {
		t.Fatal(err)
	}
	job, err := q.Claim(ctx, "old", []string{kind})
	if err != nil {
		t.Fatal(err)
	}
	err = q.RunUnits(ctx, job, 3, func(_ context.Context, i int) (int, error) {
		if i == 0 {
			// The lease is taken over while the unit runs.
			if _, err := pool.Exec(ctx, `UPDATE jobs SET locked_by = 'new' WHERE id = $1`, id); err != nil {
				t.Fatal(err)
			}
		}
		return 1, nil
	})
	if !errors.Is(err, jobs.ErrLeaseLost) {
		t.Fatalf("err = %v, want ErrLeaseLost", err)
	}
	fresh, _ := q.Get(ctx, id)
	if p := jobs.ProgressOf(fresh); p.Done != 0 {
		t.Fatalf("the old worker's checkpoint was written: %+v", p)
	}
}
