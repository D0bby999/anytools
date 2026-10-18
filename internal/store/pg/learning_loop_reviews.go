package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/learning/loop"
)

// ─────────────────────────────────────────────────────────── weekly reviews

const reviewColumns = `id, user_id, cycle_id, week_no, completion, quality, retention, transfer,
	errors, energy, one_variable_change, writeback_done, written_back_at, created_at, updated_at`

// CreateReview opens a week's review. A second review for the same week is
// ErrConflict (the unique constraint), and a cycle that is not the caller's
// is ErrNotFound (the INSERT … SELECT finds nothing to insert from).
func (s *LoopStore) CreateReview(ctx context.Context, userID, cycleID uuid.UUID, week int) (*loop.WeeklyReview, error) {
	return scanReview(s.pool.QueryRow(ctx, `
		INSERT INTO weekly_reviews (user_id, cycle_id, week_no)
		SELECT $1, id, $3 FROM cycles WHERE id = $2 AND user_id = $1
		RETURNING `+reviewColumns, userID, cycleID, week))
}

// ListReviews returns a cycle's reviews in week order.
func (s *LoopStore) ListReviews(ctx context.Context, userID, cycleID uuid.UUID) ([]loop.WeeklyReview, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+reviewColumns+` FROM weekly_reviews
		 WHERE cycle_id = $1 AND user_id = $2 ORDER BY week_no`, cycleID, userID)
	if err != nil {
		return nil, fmt.Errorf("list weekly reviews: %w", err)
	}
	defer rows.Close()
	out := []loop.WeeklyReview{}
	for rows.Next() {
		r, err := scanReview(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// GetReview reads one review scoped to its owner.
func (s *LoopStore) GetReview(ctx context.Context, userID, id uuid.UUID) (*loop.WeeklyReview, error) {
	return scanReview(s.pool.QueryRow(ctx,
		`SELECT `+reviewColumns+` FROM weekly_reviews WHERE id = $1 AND user_id = $2`, id, userID))
}

// UpdateReview applies a patch. A written-back review is frozen: its
// hypotheses are already in the state, and editing the review afterwards
// would make the two disagree about what the week found.
func (s *LoopStore) UpdateReview(
	ctx context.Context, userID, id uuid.UUID, p loop.ReviewPatch,
) (*loop.WeeklyReview, error) {
	var errs []byte
	if p.Errors != nil {
		var err error
		if errs, err = json.Marshal(derefOr(p.Errors)); err != nil {
			return nil, err
		}
	}
	r, err := scanReview(s.pool.QueryRow(ctx, `
		UPDATE weekly_reviews
		   SET completion = COALESCE($3, completion),
		       quality = COALESCE($4, quality),
		       retention = COALESCE($5, retention),
		       transfer = COALESCE($6, transfer),
		       errors = COALESCE($7::jsonb, errors),
		       energy = COALESCE($8, energy),
		       one_variable_change = COALESCE($9, one_variable_change),
		       updated_at = now()
		 WHERE id = $1 AND user_id = $2 AND NOT writeback_done
		RETURNING `+reviewColumns,
		id, userID, p.Completion, p.Quality, p.Retention, p.Transfer, errs, p.Energy, p.OneVariableChange))
	if errors.Is(err, loop.ErrNotFound) {
		if _, getErr := s.GetReview(ctx, userID, id); getErr == nil {
			return nil, fmt.Errorf("%w: this review has been written back and can no longer change", loop.ErrConflict)
		}
	}
	return r, err
}

// ApplyWriteback writes a review into its state in one transaction.
//
// The review row is locked FOR UPDATE before the rules run, so two writebacks
// of the same review cannot both see writeback_done = false and both append
// the same hypotheses.
func (s *LoopStore) ApplyWriteback(
	ctx context.Context, userID, id uuid.UUID,
	plan func(loop.WeeklyReview, int) ([]loop.Hypothesis, error),
) (*loop.WeeklyReview, *loop.LearningState, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("writeback: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	r, err := scanReview(tx.QueryRow(ctx,
		`SELECT `+reviewColumns+` FROM weekly_reviews WHERE id = $1 AND user_id = $2 FOR UPDATE`, id, userID))
	if err != nil {
		return nil, nil, err
	}
	var accepted int
	if err := tx.QueryRow(ctx, `
		SELECT count(*) FROM evidence_refs
		 WHERE review_id = $1 AND user_id = $2 AND status = 'accepted'`, id, userID).Scan(&accepted); err != nil {
		return nil, nil, fmt.Errorf("writeback: count evidence: %w", err)
	}
	hyps, err := plan(*r, accepted)
	if err != nil {
		return nil, nil, err
	}
	raw, err := json.Marshal(hyps)
	if err != nil {
		return nil, nil, err
	}

	st, err := scanState(tx.QueryRow(ctx, `
		UPDATE learning_states
		   SET hypotheses = hypotheses || $3::jsonb, updated_at = clock_timestamp()
		 WHERE user_id = $2 AND id = (SELECT state_id FROM cycles WHERE id = $1 AND user_id = $2)
		RETURNING `+stateColumns, r.CycleID, userID, raw))
	if err != nil {
		return nil, nil, err
	}
	done, err := scanReview(tx.QueryRow(ctx, `
		UPDATE weekly_reviews SET writeback_done = true, written_back_at = now(), updated_at = now()
		 WHERE id = $1 AND user_id = $2
		RETURNING `+reviewColumns, id, userID))
	if err != nil {
		return nil, nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("writeback: %w", err)
	}
	return done, st, nil
}

func scanReview(row pgx.Row) (*loop.WeeklyReview, error) {
	var r loop.WeeklyReview
	var completion, quality, retention, transfer *int16
	var errs []byte
	if err := row.Scan(&r.ID, &r.UserID, &r.CycleID, &r.WeekNo, &completion, &quality, &retention, &transfer,
		&errs, &r.Energy, &r.OneVariableChange, &r.WritebackDone, &r.WrittenBackAt,
		&r.CreatedAt, &r.UpdatedAt); err != nil {
		return nil, notFoundOr(err, "scan weekly review")
	}
	widen := func(v *int16) *int {
		if v == nil {
			return nil
		}
		n := int(*v)
		return &n
	}
	r.Completion, r.Quality, r.Retention, r.Transfer = widen(completion), widen(quality), widen(retention), widen(transfer)
	if err := jsonInto(errs, &r.Errors); err != nil {
		return nil, err
	}
	if r.Errors == nil {
		r.Errors = []loop.ReviewError{}
	}
	return &r, nil
}
