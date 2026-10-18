package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/D0bby999/anytools/internal/learning/loop"
)

// ─────────────────────────────────────────────────────────────────── cycles

const cycleColumns = `id, user_id, state_id, started_at, phase, gate_evidence, weekly_questions,
	interruptions, day90_review_md, created_at, updated_at`

// CreateCycle starts a cycle on a state.
func (s *LoopStore) CreateCycle(ctx context.Context, userID, stateID uuid.UUID, startedAt time.Time) (*loop.Cycle, error) {
	c, err := scanCycle(s.pool.QueryRow(ctx, `
		INSERT INTO cycles (user_id, state_id, started_at)
		SELECT $1, id, $3 FROM learning_states WHERE id = $2 AND user_id = $1
		RETURNING `+cycleColumns, userID, stateID, startedAt))
	return c, err
}

// CurrentCycle is the state's most recently started cycle.
func (s *LoopStore) CurrentCycle(ctx context.Context, userID, stateID uuid.UUID) (*loop.Cycle, error) {
	return scanCycle(s.pool.QueryRow(ctx, `
		SELECT `+cycleColumns+` FROM cycles
		 WHERE state_id = $1 AND user_id = $2
		 ORDER BY started_at DESC, created_at DESC LIMIT 1`, stateID, userID))
}

// GetCycle reads one cycle scoped to its owner.
func (s *LoopStore) GetCycle(ctx context.Context, userID, id uuid.UUID) (*loop.Cycle, error) {
	return scanCycle(s.pool.QueryRow(ctx,
		`SELECT `+cycleColumns+` FROM cycles WHERE id = $1 AND user_id = $2`, id, userID))
}

// UpdateCycle applies a patch.
func (s *LoopStore) UpdateCycle(ctx context.Context, userID, id uuid.UUID, p loop.CyclePatch) (*loop.Cycle, error) {
	var questions []byte
	if p.WeeklyQuestions != nil {
		var err error
		if questions, err = json.Marshal(derefOr(p.WeeklyQuestions)); err != nil {
			return nil, err
		}
	}
	return scanCycle(s.pool.QueryRow(ctx, `
		UPDATE cycles
		   SET weekly_questions = COALESCE($3::jsonb, weekly_questions),
		       day90_review_md = COALESCE($4, day90_review_md),
		       updated_at = now()
		 WHERE id = $1 AND user_id = $2
		RETURNING `+cycleColumns, id, userID, questions, p.Day90ReviewMD))
}

// AdvanceCycle moves the phase and freezes the evidence the move rests on.
//
// Compare-and-set on the phase: two advances racing from the same phase both
// saw an open gate, and only one of them may move the cycle. The loser gets
// ErrConflict rather than a second phase step on evidence counted once.
func (s *LoopStore) AdvanceCycle(ctx context.Context, userID, id uuid.UUID, rec loop.GateRecord) (*loop.Cycle, error) {
	if rec.RefIDs == nil {
		rec.RefIDs = []uuid.UUID{}
	}
	raw, err := json.Marshal([]loop.GateRecord{rec})
	if err != nil {
		return nil, err
	}
	c, err := scanCycle(s.pool.QueryRow(ctx, `
		UPDATE cycles
		   SET phase = $4, gate_evidence = gate_evidence || $5::jsonb, updated_at = now()
		 WHERE id = $1 AND user_id = $2 AND phase = $3
		RETURNING `+cycleColumns, id, userID, rec.From, rec.To, raw))
	if errors.Is(err, loop.ErrNotFound) {
		// Either not theirs (the caller read it a moment ago, so unlikely) or
		// the phase already moved. Both are "this request is stale".
		return nil, fmt.Errorf("%w: the cycle has already moved on", loop.ErrConflict)
	}
	return c, err
}

// GateInputs gathers what a gate may read: accepted-or-not refs on the
// cycle's reviews, refs on the state's chains recorded since the cycle
// started, and the count of written-back reviews.
//
// A chain belongs to the state rather than the cycle, so its evidence is
// windowed by the cycle's start: the previous cycle's delayed check must not
// open this cycle's gate.
func (s *LoopStore) GateInputs(ctx context.Context, userID, cycleID uuid.UUID) ([]loop.GateRef, int, error) {
	rows, err := s.pool.Query(ctx, `
		WITH c AS (SELECT id, state_id, started_at FROM cycles WHERE id = $1 AND user_id = $2)
		SELECT e.id, e.kind, COALESCE(e.timepoint, ''), e.status
		  FROM evidence_refs e
		  JOIN weekly_reviews r ON r.id = e.review_id AND r.user_id = e.user_id
		  JOIN c ON c.id = r.cycle_id
		 WHERE e.user_id = $2
		UNION ALL
		SELECT e.id, e.kind, COALESCE(e.timepoint, ''), e.status
		  FROM evidence_refs e
		  JOIN evidence_chains ch ON ch.id = e.chain_id AND ch.user_id = e.user_id
		  JOIN c ON c.state_id = ch.state_id
		 WHERE e.user_id = $2 AND e.created_at >= c.started_at`, cycleID, userID)
	if err != nil {
		return nil, 0, fmt.Errorf("gate inputs: %w", err)
	}
	defer rows.Close()
	refs := []loop.GateRef{}
	for rows.Next() {
		var r loop.GateRef
		if err := rows.Scan(&r.ID, &r.Kind, &r.Timepoint, &r.Status); err != nil {
			return nil, 0, fmt.Errorf("gate inputs: scan: %w", err)
		}
		refs = append(refs, r)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	var reviews int
	if err := s.pool.QueryRow(ctx, `
		SELECT count(*) FROM weekly_reviews
		 WHERE cycle_id = $1 AND user_id = $2 AND writeback_done`, cycleID, userID).Scan(&reviews); err != nil {
		return nil, 0, fmt.Errorf("gate inputs: reviews: %w", err)
	}
	return refs, reviews, nil
}

func scanCycle(row pgx.Row) (*loop.Cycle, error) {
	var c loop.Cycle
	var gate, questions, interruptions []byte
	if err := row.Scan(&c.ID, &c.UserID, &c.StateID, &c.StartedAt, &c.Phase, &gate, &questions,
		&interruptions, &c.Day90ReviewMD, &c.CreatedAt, &c.UpdatedAt); err != nil {
		return nil, notFoundOr(err, "scan cycle")
	}
	if err := jsonInto(gate, &c.GateEvidence); err != nil {
		return nil, err
	}
	if err := jsonInto(questions, &c.WeeklyQuestions); err != nil {
		return nil, err
	}
	if err := jsonInto(interruptions, &c.Interruptions); err != nil {
		return nil, err
	}
	if c.GateEvidence == nil {
		c.GateEvidence = []loop.GateRecord{}
	}
	if c.WeeklyQuestions == nil {
		c.WeeklyQuestions = []loop.WeeklyQuestion{}
	}
	if c.Interruptions == nil {
		c.Interruptions = []loop.Interruption{}
	}
	return &c, nil
}

// ───────────────────────────────────────────────────────────────── helpers

// notFoundOr maps "no row" to loop.ErrNotFound, and a malformed or foreign
// reference the database refused (a foreign key naming someone else's parent)
// to the same thing: the caller must not learn which it was.
func notFoundOr(err error, what string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return loop.ErrNotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23503": // foreign_key_violation
			return loop.ErrNotFound
		case "23505": // unique_violation
			return fmt.Errorf("%w: that already exists", loop.ErrConflict)
		case "23514": // check_violation
			return fmt.Errorf("%w: a value is out of range", loop.ErrInvalid)
		}
	}
	return fmt.Errorf("%s: %w", what, err)
}

// execOne runs a statement that must touch exactly one of the caller's rows.
func execOne(ctx context.Context, pool *Pool, sql string, args ...any) error {
	tag, err := pool.Exec(ctx, sql, args...)
	if err != nil {
		return notFoundOr(err, "loop write")
	}
	if tag.RowsAffected() == 0 {
		return loop.ErrNotFound
	}
	return nil
}

func jsonInto(raw []byte, v any) error {
	if len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, v); err != nil {
		return fmt.Errorf("decode jsonb: %w", err)
	}
	return nil
}

// derefOr returns *p, and an empty (non-nil) slice for a nil one, so a list
// cleared by the caller is stored as `[]` rather than `null`.
func derefOr[T any](p *[]T) []T {
	if p == nil || *p == nil {
		return []T{}
	}
	return *p
}

// prefixed qualifies a column list with a table alias.
func prefixed(alias, cols string) string {
	parts := strings.Split(cols, ",")
	for i, p := range parts {
		parts[i] = alias + "." + strings.TrimSpace(p)
	}
	return strings.Join(parts, ", ")
}
