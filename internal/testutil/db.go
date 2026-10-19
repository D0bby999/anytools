// Package testutil provides shared helpers for database integration tests.
//
// Ported from postclaw internal/testutil/db.go with one deliberate change: in
// CI, a missing database is a FAILURE, not a skip.
//
// postclaw's version skipped unconditionally, so every DB-backed assertion in
// the suite silently evaporated on any runner without a database — a green
// build that had proven nothing about the code that touches Postgres. The CI
// workflow now runs a `postgres` service container and sets ANYTOOLS_TEST_DSN;
// if either ever disappears, these tests go red instead of quiet.
package testutil

import (
	"context"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/store/kbindex"
	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultTestDSN = "postgres://localhost:5432/anytools_test?sslmode=disable"

var (
	sharedPool  *pgxpool.Pool
	connectErr  error
	connectOnce sync.Once
)

// TestDSN returns the DSN integration tests connect to.
func TestDSN() string {
	if dsn := config.Getenv("ANYTOOLS_TEST_DSN"); dsn != "" {
		return dsn
	}
	return defaultTestDSN
}

// InCI reports whether the process is running on a CI runner, where an
// unavailable test database must fail the build rather than skip silently.
func InCI() bool { return os.Getenv("CI") == "1" || os.Getenv("CI") == "true" }

// TestDB returns a shared pool connected to the test database.
//
// Locally it skips when no database is reachable, so `go test ./...` on a
// laptop without Postgres still runs the pure-Go suite. In CI it calls
// t.Fatal: a skipped database test there is an untested database.
func TestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	connectOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		pool, err := pgxpool.New(ctx, TestDSN())
		if err != nil {
			connectErr = err
			return
		}
		if err := pool.Ping(ctx); err != nil {
			pool.Close()
			connectErr = err
			return
		}
		// Every test's users are deleted by cascade, which leaves their
		// knowledge bases' vector indexes behind; thousands of them made every
		// delete reaching chunks run out of lock slots. Best effort: a
		// database without the schema yet has nothing to sweep.
		_ = kbindex.DropOrphans(ctx, pool)
		sharedPool = pool
	})

	if sharedPool == nil {
		// Redacted: this message lands in CI logs, and the DSN carries the
		// database password.
		msg := "anytools_test database not available at " + redactDSN(TestDSN()) +
			" — set ANYTOOLS_TEST_DSN to override"
		if connectErr != nil {
			msg += " (" + connectErr.Error() + ")"
		}
		if InCI() {
			t.Fatal("CI=1: " + msg + "; CI must run DB-backed tests for real, not skip them")
		}
		t.Skip(msg)
	}
	return sharedPool
}

// redactDSN strips credentials from a connection string so it can be logged.
// An unparseable value is replaced wholesale rather than echoed — a DSN that
// does not parse is exactly the one most likely to be a malformed paste of a
// real one.
func redactDSN(dsn string) string {
	u, err := url.Parse(dsn)
	if err != nil {
		return "<unparseable dsn>"
	}
	if u.User != nil {
		u.User = url.User("***")
	}
	return u.String()
}

// WithTx runs fn inside a transaction that is always rolled back, giving each
// test a clean slate without truncating shared tables.
func WithTx(t *testing.T, pool *pgxpool.Pool, fn func(ctx context.Context, tx Tx)) {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("testutil.WithTx: begin tx: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	fn(ctx, tx)
}
