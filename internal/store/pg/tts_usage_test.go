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

// Phase 22: 60 minutes of built-in speech a day, spent atomically. Two
// overviews of 40 minutes at once: exactly one is booked.
func TestBuiltinSpeechIsSpentAtomicallyUnderConcurrency(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	usage := pg.NewTTSUsage(pool)
	const limit = 60 * 60
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
				ok, err := usage.Spend(ctx, alice, day, 40*60, limit)
				if err != nil {
					t.Error(err)
				}
				results[i] = ok
			}()
		}
		close(start)
		wg.Wait()
		if results[0] == results[1] {
			t.Fatalf("round %d: both overviews answered %v", round, results[0])
		}
		if spent, _ := usage.Spent(ctx, alice, day); spent != 40*60 {
			t.Fatalf("round %d: spent %d", round, spent)
		}
		if ok, _ := usage.Spend(ctx, alice, day, 20*60, limit); !ok {
			t.Fatal("the last twenty minutes were refused")
		}
		if ok, _ := usage.Spend(ctx, alice, day, 1, limit); ok {
			t.Fatal("a second over the limit was spent")
		}
	}
}

// Speech and transcription are separate allowances: a day of one leaves the
// other whole.
func TestSpeechAndTranscriptionAllowancesAreSeparate(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	alice := testutil.NewUser(t, pool)
	speech, heard := pg.NewTTSUsage(pool), pg.NewSTTUsage(pool)
	if ok, _ := heard.Spend(ctx, alice, "2026-10-16", 120*60, 120*60); !ok {
		t.Fatal("transcription refused")
	}
	if ok, _ := speech.Spend(ctx, alice, "2026-10-16", 60*60, 60*60); !ok {
		t.Fatal("a full transcription day used up the speech allowance")
	}
}

// The speech allowance resets on the learner's local day too.
func TestTheSpeechAllowanceResetsOnTheLearnersLocalDay(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	usage := pg.NewTTSUsage(pool)
	alice := testutil.NewUser(t, pool)
	const zone, limit = "Asia/Ho_Chi_Minh", 60 * 60
	late := time.Date(2026, 10, 16, 16, 30, 0, 0, time.UTC) // 23:30 local
	early := late.Add(time.Hour)                            // 00:30 local, next day
	dayOf := func(at time.Time) string { return learning.LocalDay(at, zone).String() }
	if ok, _ := usage.Spend(ctx, alice, dayOf(late), limit, limit); !ok {
		t.Fatal("the first allowance was refused")
	}
	if ok, _ := usage.Spend(ctx, alice, dayOf(late), 1, limit); ok {
		t.Fatal("the day's allowance was spent twice")
	}
	if ok, _ := usage.Spend(ctx, alice, dayOf(early), 60, limit); !ok {
		t.Fatal("the allowance did not reset at local midnight")
	}
}
