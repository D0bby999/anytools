package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// PaperStore holds learning-depth phase 6's two tables: each user's share of
// the keyless OpenAlex budget, and the cached related-papers lists.
type PaperStore struct{ pool *Pool }

// NewPaperStore builds the store.
func NewPaperStore(pool *Pool) *PaperStore { return &PaperStore{pool: pool} }

// SpendKeyless takes one keyless paper search from the user's allowance for
// the UTC day, and reports false (spending nothing) once limit are spent. One
// statement, so two searches at once cannot both take the last one.
func (s *PaperStore) SpendKeyless(ctx context.Context, userID uuid.UUID, now time.Time, limit int) (bool, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
		INSERT INTO paper_search_usage (user_id, day, count) VALUES ($1, $2::date, 1)
		ON CONFLICT (user_id, day) DO UPDATE SET count = paper_search_usage.count + 1
		 WHERE paper_search_usage.count < $3
		RETURNING count`, userID, now.UTC().Format(time.DateOnly), limit).Scan(&n)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("spend paper search: %w", err)
	}
	return true, nil
}

// CachedRelated returns a knowledge base's cached list for a focus, if it was
// made after since.
func (s *PaperStore) CachedRelated(ctx context.Context, userID, kbID uuid.UUID, focus string, since time.Time, out any) (bool, error) {
	var raw []byte
	err := s.pool.QueryRow(ctx, `
		SELECT payload FROM related_paper_cache
		 WHERE user_id = $1 AND kb_id = $2 AND focus = $3 AND created_at >= $4`,
		userID, kbID, focus, since).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("related papers cache: %w", err)
	}
	return true, json.Unmarshal(raw, out)
}

// FocusesSince counts the distinct focuses cached for a knowledge base since.
func (s *PaperStore) FocusesSince(ctx context.Context, userID, kbID uuid.UUID, since time.Time) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
		SELECT count(*) FROM related_paper_cache WHERE user_id = $1 AND kb_id = $2 AND created_at >= $3`,
		userID, kbID, since).Scan(&n)
	return n, err
}

// PutRelated stores (or refreshes) a knowledge base's list for a focus. The
// composite foreign key refuses a knowledge base the user does not own.
func (s *PaperStore) PutRelated(ctx context.Context, userID, kbID uuid.UUID, focus string, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO related_paper_cache (user_id, kb_id, focus, payload) VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, kb_id, focus) DO UPDATE SET payload = EXCLUDED.payload, created_at = now()`,
		userID, kbID, focus, raw)
	if err != nil {
		return fmt.Errorf("related papers cache: %w", err)
	}
	return nil
}
