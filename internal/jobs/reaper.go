package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ReapedJob is one job whose lease expired, or which has just given up.
type ReapedJob struct {
	ID     uuid.UUID
	UserID uuid.UUID
	Kind   string
	// Payload is carried here so a handler need not re-read it. The reaper
	// sweeps up to 200 rows with a write transaction open; one SELECT per row
	// inside that transaction is 200 round trips holding locks everything else
	// is waiting on.
	Payload json.RawMessage
	// Terminal is true when the job ran out of attempts and is now `failed`.
	// False means it went back to `queued` and will be tried again.
	Terminal bool
}

// ReapHandler is called inside the reaper's transaction, once per reaped job.
//
// Inside, deliberately. The phase rule is that "document status transitions are
// atomic with job state": if the job row said `failed` and the document row
// still said `parsing` because the handler ran afterwards and the process died
// in between, the stuck-document failure this whole package exists to prevent
// would be back, just one layer down.
type ReapHandler func(ctx context.Context, tx pgx.Tx, job ReapedJob) error

// Reaper requeues or fails jobs whose leases have expired.
type Reaper struct {
	pool    *pgxpool.Pool
	handler ReapHandler
	every   time.Duration
}

// NewReaper returns a Reaper sweeping at `every` (default one minute).
func NewReaper(pool *pgxpool.Pool, handler ReapHandler, every time.Duration) *Reaper {
	if every <= 0 {
		every = time.Minute
	}
	return &Reaper{pool: pool, handler: handler, every: every}
}

// reapSQL takes back every expired lease in one statement.
//
// `FOR UPDATE SKIP LOCKED` in the sub-select means two reapers — or a reaper
// and a heartbeat — never deadlock over the same row; the loser simply sees
// nothing to do.
const reapSQL = `
WITH expired AS (
    SELECT id FROM jobs
    WHERE status = 'running' AND lease_expires_at < now()
    ORDER BY lease_expires_at
    FOR UPDATE SKIP LOCKED
    LIMIT $1
)
UPDATE jobs SET
    status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
    locked_by = NULL,
    lease_expires_at = NULL,
    last_error = CASE
        WHEN last_error = '' THEN 'worker lease expired before the job reported a result'
        ELSE last_error
    END,
    run_after = now() + (least(attempts, 6) * interval '10 seconds'),
    updated_at = now()
FROM expired
WHERE jobs.id = expired.id
RETURNING jobs.id, jobs.user_id, jobs.kind, jobs.payload, jobs.status = 'failed'`

// ReapOnce sweeps expired leases and returns what it took back.
func (r *Reaper) ReapOnce(ctx context.Context) ([]ReapedJob, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("jobs: reap begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	rows, err := tx.Query(ctx, reapSQL, 200)
	if err != nil {
		return nil, fmt.Errorf("jobs: reap: %w", err)
	}
	var reaped []ReapedJob
	for rows.Next() {
		var j ReapedJob
		if err := rows.Scan(&j.ID, &j.UserID, &j.Kind, &j.Payload, &j.Terminal); err != nil {
			rows.Close()
			return nil, fmt.Errorf("jobs: reap scan: %w", err)
		}
		reaped = append(reaped, j)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("jobs: reap rows: %w", err)
	}

	if r.handler != nil {
		for _, j := range reaped {
			if err := r.handler(ctx, tx, j); err != nil {
				return nil, fmt.Errorf("jobs: reap handler for %s: %w", j.ID, err)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("jobs: reap commit: %w", err)
	}
	return reaped, nil
}

// Run sweeps once immediately and then on a ticker until ctx is cancelled.
//
// The immediate sweep is the important one. After a restart every job the dead
// process held is expired by definition; waiting a full interval to notice
// leaves the user staring at a document that says "parsing" for a minute for no
// reason.
func (r *Reaper) Run(ctx context.Context) {
	sweep := func() {
		reaped, err := r.ReapOnce(ctx)
		if err != nil {
			if ctx.Err() == nil {
				slog.Error("jobs: reaper sweep failed", "error", err)
			}
			return
		}
		if len(reaped) > 0 {
			failed := 0
			for _, j := range reaped {
				if j.Terminal {
					failed++
				}
			}
			slog.Warn("jobs: reclaimed expired leases",
				"count", len(reaped), "failed", failed, "requeued", len(reaped)-failed)
		}
	}

	sweep()
	ticker := time.NewTicker(r.every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sweep()
		}
	}
}

// ReapHandlers runs several handlers in order, in the same transaction. Each
// handler checks the job's kind itself, so a job one of them does not own is
// a no-op for it.
func ReapHandlers(handlers ...ReapHandler) ReapHandler {
	return func(ctx context.Context, tx pgx.Tx, job ReapedJob) error {
		for _, h := range handlers {
			if err := h(ctx, tx, job); err != nil {
				return err
			}
		}
		return nil
	}
}
