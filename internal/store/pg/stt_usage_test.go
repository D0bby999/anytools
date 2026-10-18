package pg_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// Phase 21: 120 minutes a day on the built-in engine, spent atomically. Two
// jobs of 110 minutes at once: exactly one runs.
func TestBuiltinMinutesAreSpentAtomicallyUnderConcurrency(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	usage := pg.NewSTTUsage(pool)
	const limit = 120 * 60
	for round := 0; round < 5; round++ {
		alice := testutil.NewUser(t, pool)
		day := "2026-10-16"
		var wg sync.WaitGroup
		results := make([]bool, 2)
		start := make(chan struct{})
		for i := range results {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				ok, err := usage.Spend(ctx, alice, day, 110*60, limit)
				if err != nil {
					t.Error(err)
				}
				results[i] = ok
			}()
		}
		close(start)
		wg.Wait()
		if results[0] == results[1] {
			t.Fatalf("round %d: both jobs answered %v", round, results[0])
		}
		if spent, _ := usage.Spent(ctx, alice, day); spent != 110*60 {
			t.Fatalf("round %d: spent %d", round, spent)
		}
		// Ten minutes are left, and no more.
		if ok, _ := usage.Spend(ctx, alice, day, 10*60, limit); !ok {
			t.Fatal("the last ten minutes were refused")
		}
		if ok, _ := usage.Spend(ctx, alice, day, 1, limit); ok {
			t.Fatal("a second over the limit was spent")
		}
	}
}

func TestOneJobOverTheWholeAllowanceIsRefused(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	usage := pg.NewSTTUsage(pool)
	alice := testutil.NewUser(t, pool)
	if ok, _ := usage.Spend(ctx, alice, "2026-10-16", 121*60, 120*60); ok {
		t.Fatal("121 minutes fit in 120")
	}
	if spent, _ := usage.Spent(ctx, alice, "2026-10-16"); spent != 0 {
		t.Fatalf("a refusal spent %d", spent)
	}
}

// The allowance is the learner's LOCAL day: at 00:30 in Ho Chi Minh City it
// is a new day, while UTC is still on the day before.
func TestTheAllowanceResetsOnTheLearnersLocalDay(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	usage := pg.NewSTTUsage(pool)
	alice, bob := testutil.NewUser(t, pool), testutil.NewUser(t, pool)
	const zone, limit = "Asia/Ho_Chi_Minh", 120 * 60

	late := time.Date(2026, 10, 16, 16, 30, 0, 0, time.UTC) // 23:30 local, the 16th
	early := late.Add(time.Hour)                            // 00:30 local, the 17th; UTC still the 16th
	if late.UTC().Day() != early.UTC().Day() {
		t.Fatal("the fixture needs both instants on one UTC day")
	}
	dayOf := func(at time.Time) string { return learning.LocalDay(at, zone).String() }

	if ok, _ := usage.Spend(ctx, alice, dayOf(late), limit, limit); !ok {
		t.Fatal("the first allowance was refused")
	}
	if ok, _ := usage.Spend(ctx, alice, dayOf(late), 60, limit); ok {
		t.Fatal("the day's allowance was spent twice")
	}
	if ok, _ := usage.Spend(ctx, alice, dayOf(early), 60, limit); !ok {
		t.Fatal("the allowance did not reset at local midnight")
	}
	// Another learner's allowance is their own.
	if ok, _ := usage.Spend(ctx, bob, dayOf(late), limit, limit); !ok {
		t.Fatal("bob's allowance was alice's")
	}
	// A refund gives back, never below zero.
	if err := usage.Refund(ctx, alice, dayOf(late), 2*limit); err != nil {
		t.Fatal(err)
	}
	if spent, _ := usage.Spent(ctx, alice, dayOf(late)); spent != 0 {
		t.Fatalf("after refund %d", spent)
	}
}
