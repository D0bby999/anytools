package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/learning/loop"
)

// LoopStore is the learning loop's persistence.
//
// Same rule as every store in this package: EVERY statement names user_id,
// including those whose id is already a primary key (RT-3). The composite
// foreign keys in 1789720000_learning_loop make a cross-tenant row impossible;
// the user_id in each WHERE makes a cross-tenant READ return nothing.
//
// The file is split by entity — this one holds states and cycles; reviews,
// evidence, and briefs/logs live beside it in learning_loop_*.go.
type LoopStore struct{ pool *Pool }

// NewLoopStore builds a LoopStore over the shared pool.
func NewLoopStore(pool *Pool) *LoopStore { return &LoopStore{pool: pool} }

// ─────────────────────────────────────────────────────────────────── states

const stateColumns = `id, user_id, goal, real_scenario, outcome_12w, ai_boundaries, baselines,
	validated_methods, hypotheses, handover_md, next_task, next_task_minimum, created_at, updated_at,
	minimum_contract`

// CreateStateWithCycle is the minimal start: the state and its first cycle in
// one transaction, so a start that half-fails leaves nothing behind.
func (s *LoopStore) CreateStateWithCycle(
	ctx context.Context, st loop.LearningState, startedAt time.Time,
) (*loop.LearningState, *loop.Cycle, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("start learning state: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	created, err := scanState(tx.QueryRow(ctx, `
		INSERT INTO learning_states (user_id, goal, real_scenario, outcome_12w, next_task)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING `+stateColumns,
		st.UserID, st.Goal, st.RealScenario, st.Outcome12w, st.NextTask))
	if err != nil {
		return nil, nil, err
	}
	cycle, err := scanCycle(tx.QueryRow(ctx, `
		INSERT INTO cycles (user_id, state_id, started_at) VALUES ($1, $2, $3)
		RETURNING `+cycleColumns, st.UserID, created.ID, startedAt))
	if err != nil {
		return nil, nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("start learning state: %w", err)
	}
	return created, cycle, nil
}

// ListStates returns a user's states with their current cycle's phase.
func (s *LoopStore) ListStates(ctx context.Context, userID uuid.UUID) ([]loop.StateSummary, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+prefixed("s", stateColumns)+`, c.id, c.phase, c.started_at
		  FROM learning_states s
		  LEFT JOIN LATERAL (
		        SELECT id, phase, started_at FROM cycles
		         WHERE state_id = s.id AND user_id = s.user_id
		         ORDER BY started_at DESC, created_at DESC LIMIT 1) c ON true
		 WHERE s.user_id = $1
		 ORDER BY s.updated_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("list learning states: %w", err)
	}
	defer rows.Close()

	out := []loop.StateSummary{}
	for rows.Next() {
		var sum loop.StateSummary
		var phase *string
		var raw stateRaw
		dest := append(stateDest(&sum.LearningState, &raw), &sum.CycleID, &phase, &sum.CycleStart)
		if err := rows.Scan(dest...); err != nil {
			return nil, fmt.Errorf("scan learning state: %w", err)
		}
		if err := decodeStateJSON(&sum.LearningState, &raw); err != nil {
			return nil, err
		}
		if phase != nil {
			sum.Phase = *phase
		}
		out = append(out, sum)
	}
	return out, rows.Err()
}

// GetState reads one state scoped to its owner.
func (s *LoopStore) GetState(ctx context.Context, userID, id uuid.UUID) (*loop.LearningState, error) {
	return scanState(s.pool.QueryRow(ctx,
		`SELECT `+stateColumns+` FROM learning_states WHERE id = $1 AND user_id = $2`, id, userID))
}

// UpdateState applies a patch.
func (s *LoopStore) UpdateState(
	ctx context.Context, userID, id uuid.UUID, p loop.StatePatch,
) (*loop.LearningState, error) {
	enc := func(v any, present bool) ([]byte, error) {
		if !present {
			return nil, nil
		}
		return json.Marshal(v)
	}
	bounds, err := enc(p.AIBoundaries, p.AIBoundaries != nil)
	if err != nil {
		return nil, err
	}
	baselines, err := enc(derefOr(p.Baselines), p.Baselines != nil)
	if err != nil {
		return nil, err
	}
	methods, err := enc(derefOr(p.ValidatedMethods), p.ValidatedMethods != nil)
	if err != nil {
		return nil, err
	}
	hyps, err := enc(derefOr(p.Hypotheses), p.Hypotheses != nil)
	if err != nil {
		return nil, err
	}
	contract, err := enc(p.MinimumContract, p.MinimumContract != nil)
	if err != nil {
		return nil, err
	}
	return scanState(s.pool.QueryRow(ctx, `
		UPDATE learning_states
		   SET goal = COALESCE($3, goal),
		       real_scenario = COALESCE($4, real_scenario),
		       outcome_12w = COALESCE($5, outcome_12w),
		       ai_boundaries = COALESCE($6::jsonb, ai_boundaries),
		       baselines = COALESCE($7::jsonb, baselines),
		       validated_methods = COALESCE($8::jsonb, validated_methods),
		       hypotheses = COALESCE($9::jsonb, hypotheses),
		       handover_md = COALESCE($10, handover_md),
		       next_task = COALESCE($11, next_task),
		       next_task_minimum = COALESCE($12, next_task_minimum),
		       minimum_contract = COALESCE($13::jsonb, minimum_contract),
		       updated_at = clock_timestamp()
		 WHERE id = $1 AND user_id = $2
		RETURNING `+stateColumns,
		id, userID, p.Goal, p.RealScenario, p.Outcome12w, bounds, baselines, methods, hyps,
		p.HandoverMD, p.NextTask, p.NextTaskMinimum, contract))
}

// DeleteState removes a state; everything under it cascades.
func (s *LoopStore) DeleteState(ctx context.Context, userID, id uuid.UUID) error {
	return execOne(ctx, s.pool, `DELETE FROM learning_states WHERE id = $1 AND user_id = $2`, id, userID)
}

// RecordInterruption swaps the next task for its minimum and logs the
// interruption on the state's current cycle, in one transaction.
func (s *LoopStore) RecordInterruption(
	ctx context.Context, userID, stateID uuid.UUID, nextTask, minimum string, entry loop.Interruption,
) (*loop.LearningState, *loop.Cycle, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("record interruption: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	st, err := scanState(tx.QueryRow(ctx, `
		UPDATE learning_states
		   SET next_task = $3, next_task_minimum = $4, updated_at = clock_timestamp()
		 WHERE id = $1 AND user_id = $2
		RETURNING `+stateColumns, stateID, userID, nextTask, minimum))
	if err != nil {
		return nil, nil, err
	}
	raw, err := json.Marshal([]loop.Interruption{entry})
	if err != nil {
		return nil, nil, err
	}
	cycle, err := scanCycle(tx.QueryRow(ctx, `
		UPDATE cycles SET interruptions = interruptions || $3::jsonb, updated_at = now()
		 WHERE user_id = $2 AND id = (
		       SELECT id FROM cycles WHERE state_id = $1 AND user_id = $2
		        ORDER BY started_at DESC, created_at DESC LIMIT 1)
		RETURNING `+cycleColumns, stateID, userID, raw))
	if err != nil && !errors.Is(err, loop.ErrNotFound) {
		return nil, nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("record interruption: %w", err)
	}
	return st, cycle, nil
}

// RecentInterruptions returns a state's n most recent interruptions across all
// of its cycles, most recent first. n is the caller's bound; the state page
// asks for loop.RepeatAfter.
func (s *LoopStore) RecentInterruptions(
	ctx context.Context, userID, stateID uuid.UUID, n int,
) ([]loop.Interruption, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT e.entry
		  FROM cycles c
		 CROSS JOIN LATERAL jsonb_array_elements(c.interruptions) WITH ORDINALITY AS e(entry, pos)
		 WHERE c.state_id = $1 AND c.user_id = $2
		 ORDER BY (e.entry->>'at')::timestamptz DESC, c.started_at DESC, e.pos DESC
		 LIMIT $3`, stateID, userID, n)
	if err != nil {
		return nil, fmt.Errorf("recent interruptions: %w", err)
	}
	defer rows.Close()
	out := []loop.Interruption{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, fmt.Errorf("scan interruption: %w", err)
		}
		var it loop.Interruption
		if err := jsonInto(raw, &it); err != nil {
			return nil, fmt.Errorf("decode interruption: %w", err)
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

type stateRaw struct{ bounds, baselines, methods, hyps, contract []byte }

func stateDest(st *loop.LearningState, raw *stateRaw) []any {
	return []any{&st.ID, &st.UserID, &st.Goal, &st.RealScenario, &st.Outcome12w,
		&raw.bounds, &raw.baselines, &raw.methods, &raw.hyps,
		&st.HandoverMD, &st.NextTask, &st.NextTaskMinimum, &st.CreatedAt, &st.UpdatedAt,
		&raw.contract}
}

// decodeStateJSON unpacks the five jsonb columns out of their scan buffers.
func decodeStateJSON(st *loop.LearningState, raw *stateRaw) error {
	for _, c := range []struct {
		b []byte
		v any
	}{
		{raw.bounds, &st.AIBoundaries}, {raw.baselines, &st.Baselines}, {raw.methods, &st.ValidatedMethods},
		{raw.hyps, &st.Hypotheses}, {raw.contract, &st.MinimumContract},
	} {
		if err := jsonInto(c.b, c.v); err != nil {
			return fmt.Errorf("decode learning state: %w", err)
		}
	}
	if st.AIBoundaries.AIMay == nil {
		st.AIBoundaries.AIMay = []string{}
	}
	if st.AIBoundaries.HumanMustConfirm == nil {
		st.AIBoundaries.HumanMustConfirm = []string{}
	}
	if st.Baselines == nil {
		st.Baselines = []loop.Baseline{}
	}
	if st.ValidatedMethods == nil {
		st.ValidatedMethods = []loop.Method{}
	}
	if st.Hypotheses == nil {
		st.Hypotheses = []loop.Hypothesis{}
	}
	return nil
}

func scanState(row pgx.Row) (*loop.LearningState, error) {
	var st loop.LearningState
	var raw stateRaw
	if err := row.Scan(stateDest(&st, &raw)...); err != nil {
		return nil, notFoundOr(err, "scan learning state")
	}
	if err := decodeStateJSON(&st, &raw); err != nil {
		return nil, err
	}
	return &st, nil
}

// LoopStore implements loop.Store; this line fails the build if it drifts.
var _ loop.Store = (*LoopStore)(nil)
