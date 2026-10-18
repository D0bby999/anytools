package pg

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// tts_usage.go — each learner's daily share of the built-in Kokoro voices
// (up-methods phase 22), in seconds of speech. The same EngineUsage as
// transcription's, over its own table.

// NewTTSUsage is the built-in speech allowance, in seconds of speech.
func NewTTSUsage(pool *Pool) *EngineUsage { return newEngineUsage(pool, "tts_usage") }

// refundTTSTx gives back seconds of speech inside a job's final transaction
// (AudioReapHandler), never below zero.
func refundTTSTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, day string, seconds int) error {
	if day == "" || seconds <= 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `
		UPDATE tts_usage SET seconds = GREATEST(0, seconds - $3)
		 WHERE user_id = $1 AND day = $2::date`, userID, day, seconds)
	if err != nil {
		return fmt.Errorf("refund tts_usage: %w", err)
	}
	return nil
}
