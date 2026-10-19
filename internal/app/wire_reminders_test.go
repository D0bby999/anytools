package app

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/testutil"
)

// The reminder's total reads every row Home counts against a real schema, so
// a renamed column in any of the six queries fails here rather than at 07:00.
// Words are the row seeded: due ones count, a card due tomorrow does not, and
// another learner's never does.
func TestDueTotalCountsWhatIsDueForThisLearnerOnly(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	loopSvc, _, _ := buildLoop(pool, nil)
	count := newDueTotal(pool, loopSvc)
	alice, bob := testutil.NewUser(t, pool), testutil.NewUser(t, pool)

	card := func(user uuid.UUID, due time.Time) {
		t.Helper()
		var note uuid.UUID
		if err := pool.QueryRow(ctx, `INSERT INTO vocab_notes (user_id, term, lang, meaning)
			VALUES ($1, $2, 'en', 'm') RETURNING id`, user, "w"+uuid.NewString()[:8]).Scan(&note); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO vocab_cards (user_id, note_id, kind, due_at)
			VALUES ($1, $2, 'cloze', $3)`, user, note, due); err != nil {
			t.Fatal(err)
		}
	}

	if n, err := count.DueTotal(ctx, alice); err != nil || n != 0 {
		t.Fatalf("nothing yet: %d, %v", n, err)
	}
	card(alice, time.Now().Add(-time.Hour))
	card(alice, time.Now().Add(-48*time.Hour))
	card(alice, time.Now().Add(72*time.Hour))
	card(bob, time.Now().Add(-time.Hour))

	if n, err := count.DueTotal(ctx, alice); err != nil || n != 2 {
		t.Fatalf("alice: %d, %v; want her two due words", n, err)
	}
}
