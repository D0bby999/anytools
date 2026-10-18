package pg

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/learning/loop"
)

// learning_loop_briefs.go holds the three state-owned documents that are
// edited as a whole: evidence chains, AI task briefs and AI learning logs.
// Each is read, changed in Go, and saved back — they have no counters or
// append-only columns that a read-modify-write could race on.

// ─────────────────────────────────────────────────────────────────── chains

const chainColumns = `id, user_id, state_id, question, split, created_at, updated_at`

// CreateChain inserts a chain under a state the caller owns.
func (s *LoopStore) CreateChain(ctx context.Context, c loop.Chain) (*loop.Chain, error) {
	split, err := json.Marshal(c.Split)
	if err != nil {
		return nil, err
	}
	return scanChain(s.pool.QueryRow(ctx, `
		INSERT INTO evidence_chains (user_id, state_id, question, split)
		VALUES ($1, $2, $3, $4) RETURNING `+chainColumns, c.UserID, c.StateID, c.Question, split))
}

// ListChains returns a state's chains, newest first.
func (s *LoopStore) ListChains(ctx context.Context, userID, stateID uuid.UUID) ([]loop.Chain, error) {
	return listRows(ctx, s.pool, scanChain, `
		SELECT `+chainColumns+` FROM evidence_chains
		 WHERE state_id = $1 AND user_id = $2 ORDER BY created_at DESC`, stateID, userID)
}

// GetChain reads one chain scoped to its owner.
func (s *LoopStore) GetChain(ctx context.Context, userID, id uuid.UUID) (*loop.Chain, error) {
	return scanChain(s.pool.QueryRow(ctx,
		`SELECT `+chainColumns+` FROM evidence_chains WHERE id = $1 AND user_id = $2`, id, userID))
}

// SaveChain writes a chain's editable fields back.
func (s *LoopStore) SaveChain(ctx context.Context, c loop.Chain) (*loop.Chain, error) {
	split, err := json.Marshal(c.Split)
	if err != nil {
		return nil, err
	}
	return scanChain(s.pool.QueryRow(ctx, `
		UPDATE evidence_chains SET question = $3, split = $4, updated_at = now()
		 WHERE id = $1 AND user_id = $2 RETURNING `+chainColumns, c.ID, c.UserID, c.Question, split))
}

// DeleteChain removes a chain; its refs cascade.
func (s *LoopStore) DeleteChain(ctx context.Context, userID, id uuid.UUID) error {
	return execOne(ctx, s.pool, `DELETE FROM evidence_chains WHERE id = $1 AND user_id = $2`, id, userID)
}

func scanChain(row pgx.Row) (*loop.Chain, error) {
	var c loop.Chain
	var split []byte
	if err := row.Scan(&c.ID, &c.UserID, &c.StateID, &c.Question, &split, &c.CreatedAt, &c.UpdatedAt); err != nil {
		return nil, notFoundOr(err, "scan evidence chain")
	}
	return &c, jsonInto(split, &c.Split)
}

// ─────────────────────────────────────────────────────────────────── briefs

const briefColumns = `id, user_id, state_id, task, data_boundary_note, output_eval, ai_scope, human_gates,
	cost_reversibility, failure_rollback, handover, pre_start_check, created_at, updated_at`

// CreateBrief inserts a brief under a state the caller owns.
func (s *LoopStore) CreateBrief(ctx context.Context, b loop.Brief) (*loop.Brief, error) {
	check, err := checkJSON(b.PreStartCheck)
	if err != nil {
		return nil, err
	}
	return scanBrief(s.pool.QueryRow(ctx, `
		INSERT INTO ai_task_briefs (user_id, state_id, task, data_boundary_note, output_eval, ai_scope,
		                            human_gates, cost_reversibility, failure_rollback, handover, pre_start_check)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING `+briefColumns,
		b.UserID, b.StateID, b.Task, b.DataBoundaryNote, b.OutputEval, b.AIScope,
		b.HumanGates, b.CostReversibility, b.FailureRollback, b.Handover, check))
}

// ListBriefs returns a state's briefs, newest first.
func (s *LoopStore) ListBriefs(ctx context.Context, userID, stateID uuid.UUID) ([]loop.Brief, error) {
	return listRows(ctx, s.pool, scanBrief, `
		SELECT `+briefColumns+` FROM ai_task_briefs
		 WHERE state_id = $1 AND user_id = $2 ORDER BY created_at DESC`, stateID, userID)
}

// GetBrief reads one brief scoped to its owner.
func (s *LoopStore) GetBrief(ctx context.Context, userID, id uuid.UUID) (*loop.Brief, error) {
	return scanBrief(s.pool.QueryRow(ctx,
		`SELECT `+briefColumns+` FROM ai_task_briefs WHERE id = $1 AND user_id = $2`, id, userID))
}

// SaveBrief writes a brief's editable fields back.
func (s *LoopStore) SaveBrief(ctx context.Context, b loop.Brief) (*loop.Brief, error) {
	check, err := checkJSON(b.PreStartCheck)
	if err != nil {
		return nil, err
	}
	return scanBrief(s.pool.QueryRow(ctx, `
		UPDATE ai_task_briefs
		   SET task = $3, data_boundary_note = $4, output_eval = $5, ai_scope = $6, human_gates = $7,
		       cost_reversibility = $8, failure_rollback = $9, handover = $10, pre_start_check = $11,
		       updated_at = now()
		 WHERE id = $1 AND user_id = $2 RETURNING `+briefColumns,
		b.ID, b.UserID, b.Task, b.DataBoundaryNote, b.OutputEval, b.AIScope, b.HumanGates,
		b.CostReversibility, b.FailureRollback, b.Handover, check))
}

// DeleteBrief removes a brief; its logs cascade.
func (s *LoopStore) DeleteBrief(ctx context.Context, userID, id uuid.UUID) error {
	return execOne(ctx, s.pool, `DELETE FROM ai_task_briefs WHERE id = $1 AND user_id = $2`, id, userID)
}

func checkJSON(m map[string]bool) ([]byte, error) {
	if m == nil {
		m = map[string]bool{}
	}
	return json.Marshal(m)
}

func scanBrief(row pgx.Row) (*loop.Brief, error) {
	var b loop.Brief
	var check []byte
	if err := row.Scan(&b.ID, &b.UserID, &b.StateID, &b.Task, &b.DataBoundaryNote, &b.OutputEval, &b.AIScope,
		&b.HumanGates, &b.CostReversibility, &b.FailureRollback, &b.Handover, &check,
		&b.CreatedAt, &b.UpdatedAt); err != nil {
		return nil, notFoundOr(err, "scan ai task brief")
	}
	if err := jsonInto(check, &b.PreStartCheck); err != nil {
		return nil, err
	}
	if b.PreStartCheck == nil {
		b.PreStartCheck = map[string]bool{}
	}
	return &b, nil
}

// ───────────────────────────────────────────────────────────────────── logs

const logColumns = `id, user_id, brief_id, baseline_noai, assisted, delayed_independent, metrics,
	next_cycle_decision, created_at, updated_at`

// CreateLog inserts a log under a brief the caller owns.
func (s *LoopStore) CreateLog(ctx context.Context, l loop.Log) (*loop.Log, error) {
	cols, err := logJSON(l)
	if err != nil {
		return nil, err
	}
	return scanLog(s.pool.QueryRow(ctx, `
		INSERT INTO ai_learning_logs (user_id, brief_id, baseline_noai, assisted, delayed_independent,
		                              metrics, next_cycle_decision)
		VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING `+logColumns,
		l.UserID, l.BriefID, cols[0], cols[1], cols[2], cols[3], l.NextCycleDecision))
}

// ListLogs returns a brief's logs, oldest first — the order they were run in.
func (s *LoopStore) ListLogs(ctx context.Context, userID, briefID uuid.UUID) ([]loop.Log, error) {
	return listRows(ctx, s.pool, scanLog, `
		SELECT `+logColumns+` FROM ai_learning_logs
		 WHERE brief_id = $1 AND user_id = $2 ORDER BY created_at`, briefID, userID)
}

// GetLog reads one log scoped to its owner.
func (s *LoopStore) GetLog(ctx context.Context, userID, id uuid.UUID) (*loop.Log, error) {
	return scanLog(s.pool.QueryRow(ctx,
		`SELECT `+logColumns+` FROM ai_learning_logs WHERE id = $1 AND user_id = $2`, id, userID))
}

// SaveLog writes a log back.
func (s *LoopStore) SaveLog(ctx context.Context, l loop.Log) (*loop.Log, error) {
	cols, err := logJSON(l)
	if err != nil {
		return nil, err
	}
	return scanLog(s.pool.QueryRow(ctx, `
		UPDATE ai_learning_logs
		   SET baseline_noai = $3, assisted = $4, delayed_independent = $5, metrics = $6,
		       next_cycle_decision = $7, updated_at = now()
		 WHERE id = $1 AND user_id = $2 RETURNING `+logColumns,
		l.ID, l.UserID, cols[0], cols[1], cols[2], cols[3], l.NextCycleDecision))
}

// DeleteLog removes a log.
func (s *LoopStore) DeleteLog(ctx context.Context, userID, id uuid.UUID) error {
	return execOne(ctx, s.pool, `DELETE FROM ai_learning_logs WHERE id = $1 AND user_id = $2`, id, userID)
}

func logJSON(l loop.Log) ([4][]byte, error) {
	var out [4][]byte
	// Nil maps would encode as `null`, which the jsonb CHECKs refuse.
	loop.LogInput{}.Apply(&l)
	for i, v := range []any{l.BaselineNoAI, l.Assisted, l.DelayedIndependent, l.Metrics} {
		b, err := json.Marshal(v)
		if err != nil {
			return out, fmt.Errorf("encode learning log: %w", err)
		}
		out[i] = b
	}
	return out, nil
}

func scanLog(row pgx.Row) (*loop.Log, error) {
	var l loop.Log
	var base, assisted, delayed, metrics []byte
	if err := row.Scan(&l.ID, &l.UserID, &l.BriefID, &base, &assisted, &delayed, &metrics,
		&l.NextCycleDecision, &l.CreatedAt, &l.UpdatedAt); err != nil {
		return nil, notFoundOr(err, "scan ai learning log")
	}
	for i, pair := range []struct {
		raw []byte
		dst any
	}{{base, &l.BaselineNoAI}, {assisted, &l.Assisted}, {delayed, &l.DelayedIndependent}, {metrics, &l.Metrics}} {
		if err := jsonInto(pair.raw, pair.dst); err != nil {
			return nil, fmt.Errorf("learning log column %d: %w", i, err)
		}
	}
	loop.LogInput{}.Apply(&l) // normalizes nil maps to empty ones
	return &l, nil
}

// listRows runs a query and scans each row with scan.
func listRows[T any](ctx context.Context, pool *Pool, scan func(pgx.Row) (*T, error), sql string, args ...any) ([]T, error) {
	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("loop list: %w", err)
	}
	defer rows.Close()
	out := []T{}
	for rows.Next() {
		v, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}
