package jobs

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// position.go — where a job stands in its kind's line (up-methods phase 21:
// one built-in transcription at a time, and the page says how many are
// ahead).
//
// Counted across users, by design: the line is the server's. Only a number
// leaves this function, never another user's job.

// Ahead counts the jobs of the same kind that will run before jobID: those
// running now, and those queued to run earlier (claimSQL's order: run_after,
// then created_at). ok is false when jobID is no longer waiting or running.
func (q *Queue) Ahead(ctx context.Context, jobID uuid.UUID) (ahead int, ok bool, err error) {
	var status string
	err = q.pool.QueryRow(ctx, `
        SELECT me.status, (
            SELECT count(*) FROM jobs j
             WHERE j.kind = me.kind AND j.id <> me.id
               AND (j.status = 'running'
                    OR (me.status = 'queued' AND j.status = 'queued'
                        AND (j.run_after, j.created_at) < (me.run_after, me.created_at))))
          FROM jobs me WHERE me.id = $1`, jobID).Scan(&status, &ahead)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("jobs: ahead: %w", err)
	}
	if status != StatusQueued && status != StatusRunning {
		return 0, false, nil
	}
	return ahead, true, nil
}

// ActiveFor finds the user's queued or running job of kind for a document
// (payload document_id), if there is one.
func (q *Queue) ActiveFor(ctx context.Context, userID uuid.UUID, kind string, documentID uuid.UUID) (uuid.UUID, bool, error) {
	var id uuid.UUID
	err := q.pool.QueryRow(ctx, `
        SELECT id FROM jobs
         WHERE user_id = $1 AND kind = $2 AND status IN ('queued', 'running')
           AND payload->>'document_id' = $3
         ORDER BY created_at DESC LIMIT 1`, userID, kind, documentID.String()).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, false, nil
	}
	if err != nil {
		return uuid.Nil, false, fmt.Errorf("jobs: active for: %w", err)
	}
	return id, true, nil
}

// Waiting counts the jobs of kind queued or running now, across users.
func (q *Queue) Waiting(ctx context.Context, kind string) (int, error) {
	var n int
	if err := q.pool.QueryRow(ctx, `
        SELECT count(*) FROM jobs WHERE kind = $1 AND status IN ('queued', 'running')`, kind).Scan(&n); err != nil {
		return 0, fmt.Errorf("jobs: waiting: %w", err)
	}
	return n, nil
}
