// Package jobs is AnyTools' Postgres-backed work queue.
//
// It exists because of red-team RT-8 and Assumption 6: the first draft ran
// background work in memory, so an API restart left a document in `parsing`
// with nothing anywhere recording that the work had stopped. Every mechanism
// here targets that one failure.
//
//   - A claim is ONE short `UPDATE … RETURNING`. No long transaction is held
//     while work runs, so a worker that dies does not hold a row lock and does
//     not block the reaper.
//   - A claim takes a LEASE, not a lock. The worker extends it by heartbeat.
//     A worker that stops heartbeating — crashed, killed, network-partitioned —
//     loses the row to the reaper without having to cooperate.
//   - The reaper runs on startup and every minute. Startup matters most: after
//     a restart, every job the old process held is expired by definition and
//     must come back without waiting a full sweep interval.
//
// Docs/architecture.md pins the API to one replica. These leases are the
// precondition for ever raising that, which is why they exist before they are
// strictly needed.
package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Kind values used in this phase. Phases 7 and 10 add their own.
const (
	// KindParseDocument parses, chunks and embeds one uploaded document.
	KindParseDocument = "parse_document"
	// KindReindexKB re-embeds every chunk of a knowledge base.
	KindReindexKB = "reindex_kb"
	// KindTranscribeVideo makes an AI transcript of a public video with the
	// learner's Gemini key, one window per unit (learning-depth phase 4).
	KindTranscribeVideo = "transcribe_video"
	// KindTranscribeBuiltin is a transcription on the server's own Whisper
	// (up-methods phase 21). Its own kind, because one dedicated worker
	// claims it: one built-in job runs at a time, the others wait their turn.
	KindTranscribeBuiltin = "transcribe_builtin"
	// KindCompileBook writes a living book's chapters, one billed call per
	// unit (learning-depth phase 11, internal/capabilities/book).
	KindCompileBook = "compile_book"
	// KindExtractExam reads an exam paper and lists its questions, one
	// resumable unit per batch of pages (learning depth, phase 3).
	KindExtractExam = "extract_exam"
	// KindGenerateExam writes a mock exam's items from a knowledge base, one
	// resumable unit per item (learning depth, phase 3).
	KindGenerateExam = "generate_exam"
)

// Status values mirror the CHECK constraint on jobs.status.
const (
	StatusQueued  = "queued"
	StatusRunning = "running"
	StatusDone    = "done"
	StatusFailed  = "failed"
)

// DefaultLease is how long a claim is good for without a heartbeat.
//
// Long enough that a slow provider call does not lose the job to the reaper,
// short enough that a crash is noticed inside a couple of sweeps. Parse batches
// measured 75-200 s in Spike B, and the worker heartbeats between them.
const DefaultLease = 2 * time.Minute

// ErrNoJob is returned by Claim when nothing is available.
var ErrNoJob = errors.New("jobs: nothing to claim")

// Job is one unit of work.
type Job struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	Kind        string
	Payload     json.RawMessage
	Status      string
	Attempts    int
	MaxAttempts int
	LastError   string
	CreatedAt   time.Time
	// Progress is the handler's checkpoint (see RunUnits); '{}' when unused.
	Progress json.RawMessage
	// WorkerID is the claim's holder. Set by Claim only; RunUnits needs it
	// to write a checkpoint that a reaped job cannot overwrite.
	WorkerID string
}

// Queue is the Postgres implementation.
type Queue struct {
	pool   *pgxpool.Pool
	lease  time.Duration
	gaveUp ReapHandler
}

// NewQueue returns a Queue. A zero lease takes DefaultLease.
func NewQueue(pool *pgxpool.Pool, lease time.Duration) *Queue {
	if lease <= 0 {
		lease = DefaultLease
	}
	return &Queue{pool: pool, lease: lease}
}

// OnGaveUp registers a handler run in the SAME transaction as the job's final
// `failed` write.
//
// Symmetric with the reaper's, and needed for the same reason. The reaper
// couples job state to document state when a lease EXPIRES; without this, the
// other way a job dies — a handler returning an error on its last attempt, a
// payload this build cannot read, a kind with no registered handler — moved the
// job to `failed` and left the document wherever it happened to be. The reaper
// never finds it, because the reaper only sweeps running leases.
func (q *Queue) OnGaveUp(h ReapHandler) { q.gaveUp = h }

// Lease is the configured lease duration.
func (q *Queue) Lease() time.Duration { return q.lease }

// Enqueue adds a job.
func (q *Queue) Enqueue(ctx context.Context, userID uuid.UUID, kind string, payload any, maxAttempts int) (uuid.UUID, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return uuid.Nil, fmt.Errorf("jobs: marshal payload: %w", err)
	}
	if maxAttempts < 1 {
		maxAttempts = 3
	}
	var id uuid.UUID
	err = q.pool.QueryRow(ctx, `
        INSERT INTO jobs (user_id, kind, payload, max_attempts)
        VALUES ($1, $2, $3, $4)
        RETURNING id`, userID, kind, raw, maxAttempts).Scan(&id)
	if err != nil {
		return uuid.Nil, fmt.Errorf("jobs: enqueue: %w", err)
	}
	noteEnqueuedFor(userID)
	return id, nil
}

// claimSQL is deliberately one statement.
//
// The inner SELECT ... FOR UPDATE SKIP LOCKED is what lets several workers
// claim concurrently without any of them waiting: each skips rows another is
// already taking rather than blocking on them. attempts is incremented AT CLAIM
// TIME, not at failure time — a worker that dies before it can report anything
// is exactly the case max_attempts has to bound, and a worker that has died
// cannot increment a counter on its way out.
const claimSQL = `
UPDATE jobs SET
    status           = 'running',
    locked_by        = $1,
    lease_expires_at = now() + $2::interval,
    attempts         = attempts + 1,
    updated_at       = now()
WHERE id = (
    SELECT id FROM jobs
    WHERE status = 'queued'
      AND run_after <= now()
      AND kind = ANY($3)
      AND ($4::uuid[] IS NULL OR user_id = ANY($4))
    ORDER BY run_after, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
RETURNING id, user_id, kind, payload, status, attempts, max_attempts, last_error, created_at, progress`

// Claim takes the next available job of one of the given kinds.
func (q *Queue) Claim(ctx context.Context, workerID string, kinds []string) (*Job, error) {
	var j Job
	err := q.pool.QueryRow(ctx, claimSQL, workerID, q.lease.String(), kinds, claimableUsers()).
		Scan(&j.ID, &j.UserID, &j.Kind, &j.Payload, &j.Status, &j.Attempts, &j.MaxAttempts, &j.LastError, &j.CreatedAt, &j.Progress)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoJob
	}
	if err != nil {
		return nil, fmt.Errorf("jobs: claim: %w", err)
	}
	j.WorkerID = workerID
	return &j, nil
}

// Heartbeat extends a job's lease.
//
// It returns false when the row is no longer ours — the reaper took it while we
// were working. A worker that learns this must STOP: another worker may already
// be running the same payload, and two parsers writing chunks for one document
// is how a knowledge base ends up with every passage twice.
func (q *Queue) Heartbeat(ctx context.Context, jobID uuid.UUID, workerID string) (bool, error) {
	tag, err := q.pool.Exec(ctx, `
        UPDATE jobs
        SET lease_expires_at = now() + $3::interval, updated_at = now()
        WHERE id = $1 AND locked_by = $2 AND status = 'running'`,
		jobID, workerID, q.lease.String())
	if err != nil {
		return false, fmt.Errorf("jobs: heartbeat: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// Complete marks a job done.
func (q *Queue) Complete(ctx context.Context, jobID uuid.UUID, workerID string) error {
	_, err := q.pool.Exec(ctx, `
        UPDATE jobs
        SET status = 'done', locked_by = NULL, lease_expires_at = NULL,
            last_error = '', updated_at = now()
        WHERE id = $1 AND locked_by = $2`, jobID, workerID)
	if err != nil {
		return fmt.Errorf("jobs: complete: %w", err)
	}
	return nil
}

// Fail records an error and either requeues with backoff or gives up.
//
// `terminal` forces the give-up path for an error retrying cannot fix — an
// unsupported file type, a page cap, a document that no longer exists. Burning
// three attempts on those spends the user's provider quota to reach the same
// answer.
func (q *Queue) Fail(ctx context.Context, jobID uuid.UUID, workerID string, cause error, terminal bool) (bool, error) {
	msg := "unknown error"
	if cause != nil {
		msg = cause.Error()
	}
	// A transaction, so the gave-up handler settles the document in the same
	// commit as the job's final state. Two transactions would leave a window,
	// and a crash inside it produces a job that has given up beside a document
	// that still thinks it is being worked on.
	tx, err := q.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("jobs: fail begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var (
		status  string
		userID  uuid.UUID
		kind    string
		payload json.RawMessage
	)
	err = tx.QueryRow(ctx, `
        UPDATE jobs SET
            status = CASE WHEN $3 OR attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
            locked_by = NULL,
            lease_expires_at = NULL,
            last_error = $4,
            run_after = now() + (least(attempts, 6) * interval '10 seconds'),
            updated_at = now()
        WHERE id = $1 AND locked_by = $2
        RETURNING status, user_id, kind, payload`, jobID, workerID, terminal, truncateError(msg)).
		Scan(&status, &userID, &kind, &payload)
	if errors.Is(err, pgx.ErrNoRows) {
		// The reaper already took it. Not an error: the row is in a valid state
		// and reporting a failure over the top of it would double-count the
		// attempt.
		return true, nil
	}
	if err != nil {
		return false, fmt.Errorf("jobs: fail: %w", err)
	}

	gaveUp := status == StatusFailed
	if gaveUp && q.gaveUp != nil {
		// The payload is how a handler finds what the job owned (an audio
		// overview, a book's chapters); without it they could not settle it.
		if err := q.gaveUp(ctx, tx, ReapedJob{
			ID: jobID, UserID: userID, Kind: kind, Payload: payload, Terminal: true,
		}); err != nil {
			return false, fmt.Errorf("jobs: gave-up handler for %s: %w", jobID, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("jobs: fail commit: %w", err)
	}
	return gaveUp, nil
}

// Get reads one job, for tests and for the document status endpoint.
func (q *Queue) Get(ctx context.Context, jobID uuid.UUID) (*Job, error) {
	var j Job
	err := q.pool.QueryRow(ctx, `
        SELECT id, user_id, kind, payload, status, attempts, max_attempts, last_error, created_at, progress
        FROM jobs WHERE id = $1`, jobID).
		Scan(&j.ID, &j.UserID, &j.Kind, &j.Payload, &j.Status, &j.Attempts, &j.MaxAttempts, &j.LastError, &j.CreatedAt, &j.Progress)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoJob
	}
	if err != nil {
		return nil, err
	}
	return &j, nil
}

// truncateError bounds what goes into last_error. A provider can return a
// megabyte of HTML on a bad day and that column is read into an API response.
func truncateError(s string) string {
	const limit = 2000
	if len(s) <= limit {
		return s
	}
	return s[:limit] + "…"
}
