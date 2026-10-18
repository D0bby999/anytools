package jobs

import (
	"context"
	"fmt"
	"hash/fnv"

	"github.com/jackc/pgx/v5/pgxpool"
)

// WithAdvisoryLock runs fn while holding a Postgres session advisory lock, or
// returns false without running it when another process holds the lock.
//
// This is the cron-job primitive phases 7 and 10 need. The failure it prevents
// is the one red-team RT-8 named: two processes both deciding it is 03:00 and
// both materializing the same day's review tasks. It is `try`, not `wait` — a
// nightly job that queues up behind the one already running is a nightly job
// that runs twice.
//
// The lock is taken on ONE connection, held for the duration of fn, and
// released explicitly on the same connection. A pool-level lock would be
// released by whichever connection happened to be borrowed next, which is to
// say never reliably.
//
// It is deliberately NOT a transaction lock (`pg_advisory_xact_lock`): fn may
// run for minutes and do its own transactions, and wrapping all of that in one
// long transaction is the pattern this package's own claim query avoids.
func WithAdvisoryLock(ctx context.Context, pool *pgxpool.Pool, name string, fn func(ctx context.Context) error) (bool, error) {
	key := AdvisoryKey(name)

	conn, err := pool.Acquire(ctx)
	if err != nil {
		return false, fmt.Errorf("jobs: advisory lock acquire connection: %w", err)
	}
	defer conn.Release()

	var got bool
	if err := conn.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", key).Scan(&got); err != nil {
		return false, fmt.Errorf("jobs: pg_try_advisory_lock(%s): %w", name, err)
	}
	if !got {
		return false, nil
	}

	defer func() {
		// Unlock on a context-free background call: if fn returned because ctx
		// was cancelled, using that same ctx here would skip the unlock and
		// leave the lock held until the connection is closed.
		if _, err := conn.Exec(context.WithoutCancel(ctx),
			"SELECT pg_advisory_unlock($1)", key); err != nil {
			// The lock is released when the session ends regardless, so this is
			// a leak with a bounded lifetime rather than a deadlock.
			_ = err
		}
	}()

	if err := fn(ctx); err != nil {
		return true, err
	}
	return true, nil
}

// AdvisoryKey hashes a lock name to the bigint pg_advisory_lock takes.
//
// FNV-1a rather than anything cryptographic: this is a namespace, not a
// secret, and the only property that matters is that the same name gives the
// same number in every process. Masked to 63 bits because the Postgres
// parameter is a signed bigint and a negative key, while legal, makes every
// `pg_locks` row look like a bug.
func AdvisoryKey(name string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte("anytools:" + name))
	return int64(h.Sum64() & 0x7fffffffffffffff)
}
