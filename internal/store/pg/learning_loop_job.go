package pg

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/learning/loop"
)

// learning_loop_job.go is the suggestion job's side of the store.
//
// ActiveCycles is the ONE method of LoopStore that is not user-scoped, because
// the nightly pass is by definition across users; the job that calls it holds
// an advisory lock. Every other method here takes the cycle's own user id and
// names it in SQL like everything else.

// ActiveCycles lists each state's current cycle that is not yet delivering.
func (s *LoopStore) ActiveCycles(ctx context.Context) ([]loop.ActiveCycle, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT ON (c.state_id) c.user_id, c.id, c.state_id, c.started_at, c.phase
		  FROM cycles c
		 ORDER BY c.state_id, c.started_at DESC, c.created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("active cycles: %w", err)
	}
	defer rows.Close()
	out := []loop.ActiveCycle{}
	for rows.Next() {
		var c loop.ActiveCycle
		var phase string
		if err := rows.Scan(&c.UserID, &c.CycleID, &c.StateID, &c.StartedAt, &phase); err != nil {
			return nil, fmt.Errorf("active cycles: scan: %w", err)
		}
		// Filtered after DISTINCT ON, not in its WHERE: a state whose newest
		// cycle is delivering must not fall back to an older one.
		if phase != loop.PhaseDeliver {
			out = append(out, c)
		}
	}
	return out, rows.Err()
}

// EnsureReview returns the week's review id, creating the row if needed.
func (s *LoopStore) EnsureReview(ctx context.Context, userID, cycleID uuid.UUID, week int) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		WITH ins AS (
			INSERT INTO weekly_reviews (user_id, cycle_id, week_no)
			SELECT $1, id, $3 FROM cycles WHERE id = $2 AND user_id = $1
			ON CONFLICT (cycle_id, week_no) DO NOTHING
			RETURNING id)
		SELECT id FROM ins
		UNION ALL
		SELECT id FROM weekly_reviews WHERE cycle_id = $2 AND user_id = $1 AND week_no = $3
		LIMIT 1`, userID, cycleID, week).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, loop.ErrNotFound
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("ensure weekly review: %w", err)
	}
	return id, nil
}

// InsertSuggestion writes a suggested ref. DO NOTHING on conflict: a target
// already accepted or dismissed on this review keeps the person's decision.
func (s *LoopStore) InsertSuggestion(ctx context.Context, userID, reviewID uuid.UUID, c loop.Candidate) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO evidence_refs (user_id, review_id, timepoint, kind, ref_id, status, suggested_by)
		SELECT $1, id, NULLIF($3, ''), $4, $5, 'suggested', 'job'
		  FROM weekly_reviews WHERE id = $2 AND user_id = $1 AND NOT writeback_done
		ON CONFLICT (review_id, kind, ref_id) WHERE review_id IS NOT NULL AND chain_id IS NULL
		DO NOTHING`, userID, reviewID, c.Timepoint, c.Kind, c.RefID)
	if err != nil {
		return false, fmt.Errorf("insert suggestion: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

var _ loop.SuggestSource = (*LoopStore)(nil)
