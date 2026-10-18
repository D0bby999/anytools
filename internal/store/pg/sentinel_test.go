package pg_test

import (
	"context"
	"errors"
	"testing"

	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

const (
	keyA = "0123456789abcdef0123456789abcdef"
	keyB = "fedcba9876543210fedcba9876543210"
)

// The sentinel exists so that starting under the WRONG encryption key fails at
// boot. Without it the process starts fine and the damage — a second,
// unreadable generation of BYOK secrets interleaved with the first — only
// becomes visible much later.
func TestSentinelSeedsThenVerifiesUnderSameKey(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	resetSentinel(t, pool)

	s := pg.NewSentinelStore(pool, keyA)
	if err := s.Verify(ctx); err != nil {
		t.Fatalf("first Verify (seeds): %v", err)
	}
	if err := s.Verify(ctx); err != nil {
		t.Fatalf("second Verify (reads back): %v", err)
	}
}

func TestSentinelRejectsWrongKey(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	resetSentinel(t, pool)

	if err := pg.NewSentinelStore(pool, keyA).Verify(ctx); err != nil {
		t.Fatalf("seed under key A: %v", err)
	}

	err := pg.NewSentinelStore(pool, keyB).Verify(ctx)
	if !errors.Is(err, pg.ErrEncryptionKeyMismatch) {
		t.Fatalf("want ErrEncryptionKeyMismatch, got %v", err)
	}
}

// resetSentinel clears the singleton row so each test starts from a first-boot
// state, and restores nothing after: the next test reseeds.
func resetSentinel(t *testing.T, pool *pgxpoolAlias) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `DELETE FROM app_sentinel`); err != nil {
		t.Fatalf("reset sentinel: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM app_sentinel`)
	})
}
