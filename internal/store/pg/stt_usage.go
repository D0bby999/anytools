package pg

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/providers/builtin"
)

// stt_usage.go — each learner's daily share of a built-in engine
// (up-methods phase 21), builtin.Usage over one table per engine.
//
// One store type for every engine, because the arithmetic is the same: an
// amount (seconds of audio heard, seconds of speech spoken) per user per local
// day, spent in one statement. The table is the engine's own (stt_usage;
// phase 22 adds tts_usage), so one engine's allowance never reads another's
// rows. The name is chosen from usageTables at construction, never from a
// request: it is the one identifier this file formats into SQL.

// usageTables are the engine usage tables a migration created.
var usageTables = map[string]bool{"stt_usage": true, "tts_usage": true}

// EngineUsage is one built-in engine's allowance table.
type EngineUsage struct {
	pool  *Pool
	table string
}

var _ builtin.Usage = (*EngineUsage)(nil)

// NewSTTUsage is the built-in transcription allowance, in seconds of audio.
func NewSTTUsage(pool *Pool) *EngineUsage { return newEngineUsage(pool, "stt_usage") }

func newEngineUsage(pool *Pool, table string) *EngineUsage {
	if !usageTables[table] {
		panic("pg: unknown engine usage table " + table)
	}
	return &EngineUsage{pool: pool, table: table}
}

// Spend takes amount from the learner's allowance for day, and reports false,
// spending nothing, when the day's total would pass limit. One statement: two
// jobs at once queue on the row's lock, and the second re-reads the first's
// total before it decides.
func (u *EngineUsage) Spend(ctx context.Context, userID uuid.UUID, day string, amount, limit int) (bool, error) {
	if amount <= 0 {
		return true, nil
	}
	var n int
	err := u.pool.QueryRow(ctx, `
		INSERT INTO `+u.table+` AS u (user_id, day, seconds)
		SELECT $1, $2::date, $3::int WHERE $3::int <= $4::int
		ON CONFLICT (user_id, day) DO UPDATE SET seconds = u.seconds + EXCLUDED.seconds
		 WHERE u.seconds + EXCLUDED.seconds <= $4::int
		RETURNING seconds`, userID, day, amount, limit).Scan(&n)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("spend %s: %w", u.table, err)
	}
	return true, nil
}

// Refund gives back amount on day, never below zero.
func (u *EngineUsage) Refund(ctx context.Context, userID uuid.UUID, day string, amount int) error {
	if amount <= 0 {
		return nil
	}
	_, err := u.pool.Exec(ctx, `
		UPDATE `+u.table+` SET seconds = GREATEST(0, seconds - $3)
		 WHERE user_id = $1 AND day = $2::date`, userID, day, amount)
	if err != nil {
		return fmt.Errorf("refund %s: %w", u.table, err)
	}
	return nil
}

// Spent is the learner's total on day.
func (u *EngineUsage) Spent(ctx context.Context, userID uuid.UUID, day string) (int, error) {
	var n int
	err := u.pool.QueryRow(ctx, `SELECT seconds FROM `+u.table+` WHERE user_id = $1 AND day = $2::date`,
		userID, day).Scan(&n)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("read %s: %w", u.table, err)
	}
	return n, nil
}
