package pg_test

import (
	"context"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// Red team SF-6: one user's share of the keyless OpenAlex budget is capped
// per day, and another user's share is untouched.
func TestTheKeylessPaperBudgetIsCappedPerUserPerDay(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	store := pg.NewPaperStore(pool)
	alice, bob := testutil.NewUser(t, pool), testutil.NewUser(t, pool)
	day := time.Date(2026, 9, 27, 10, 0, 0, 0, time.UTC)
	for i := 0; i < 20; i++ {
		if ok, err := store.SpendKeyless(ctx, alice, day, 20); err != nil || !ok {
			t.Fatalf("search %d: %v, %v", i+1, ok, err)
		}
	}
	if ok, _ := store.SpendKeyless(ctx, alice, day, 20); ok {
		t.Fatal("the 21st keyless search of the day was allowed")
	}
	if ok, _ := store.SpendKeyless(ctx, bob, day, 20); !ok {
		t.Fatal("another user's budget was spent")
	}
	if ok, _ := store.SpendKeyless(ctx, alice, day.Add(24*time.Hour), 20); !ok {
		t.Fatal("the next day's budget was spent")
	}
}
