package testutil

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// fixtures.go — rows a database test needs to exist before it can assert
// anything.
//
// These insert real rows rather than running inside WithTx's rolled-back
// transaction, because the code under test uses the POOL: a store that opens
// its own connection cannot see uncommitted rows, and several of the behaviours
// being tested (the advisory lock, a cooldown surviving a "restart") are
// specifically about what two different connections can see. Cleanup is by
// t.Cleanup + ON DELETE CASCADE, so a failed test still leaves the database as
// it found it.

// NewUser inserts a live user and returns its id. The row and everything
// referencing it are deleted when the test ends.
func NewUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	ctx := context.Background()

	// A per-call uuid in the address keeps parallel tests from colliding on the
	// live-email unique index.
	email := "test-" + uuid.NewString() + "@anytools.test"

	var id uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, display_name, email_verified_at)
		 VALUES ($1, 'Test User', now()) RETURNING id`, email).Scan(&id)
	if err != nil {
		t.Fatalf("testutil.NewUser: %v", err)
	}

	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id); err != nil {
			t.Logf("testutil.NewUser: cleanup failed for %s: %v", id, err)
		}
	})
	return id
}

// TestEncryptionKey is a fixed 32-byte key for tests.
//
// Fixed rather than random so a test can write a secret with one store and read
// it back with a second — which is exactly how the "survives a process restart"
// assertions are written.
const TestEncryptionKey = "0123456789abcdef0123456789abcdef"
