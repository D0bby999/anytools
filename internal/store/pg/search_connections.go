package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/crypto"
	"github.com/D0bby999/anytools/internal/store"
)

// SearchConnectionStore is the pgx implementation of
// store.SearchConnectionStore.
type SearchConnectionStore struct {
	pool   *Pool
	encKey string
}

func NewSearchConnectionStore(pool *Pool, encKey string) *SearchConnectionStore {
	return &SearchConnectionStore{pool: pool, encKey: encKey}
}

var _ store.SearchConnectionStore = (*SearchConnectionStore)(nil)

const searchColumns = `id, user_id, provider, verified_at, last_error, created_at`

func (s *SearchConnectionStore) ListSearchConnections(ctx context.Context, userID uuid.UUID) ([]store.SearchConnection, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+searchColumns+` FROM search_connections WHERE user_id = $1 ORDER BY provider`, userID)
	if err != nil {
		return nil, fmt.Errorf("list search connections: %w", err)
	}
	defer rows.Close()

	out := []store.SearchConnection{}
	for rows.Next() {
		var c store.SearchConnection
		if err := rows.Scan(&c.ID, &c.UserID, &c.Provider, &c.VerifiedAt, &c.LastError, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// UpsertSearchConnection replaces the key for that provider rather than adding
// a second one. One key per provider per user is the whole model: a chain of
// Tavily keys would be an accounting problem, not a feature.
func (s *SearchConnectionStore) UpsertSearchConnection(ctx context.Context, userID uuid.UUID, provider, secret string) (*store.SearchConnection, error) {
	enc, err := encryptOrFail(secret, s.encKey, "search_connections.secret_enc")
	if err != nil {
		return nil, err
	}
	if enc == "" {
		return nil, errors.New("pg: refusing to store an empty search key")
	}

	var c store.SearchConnection
	err = s.pool.QueryRow(ctx, `
		INSERT INTO search_connections (user_id, provider, secret_enc)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, provider) DO UPDATE
		SET secret_enc = EXCLUDED.secret_enc,
		    -- A new key has proven nothing yet.
		    verified_at = NULL,
		    last_error = '',
		    updated_at = now()
		RETURNING `+searchColumns,
		userID, provider, enc).
		Scan(&c.ID, &c.UserID, &c.Provider, &c.VerifiedAt, &c.LastError, &c.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("upsert search connection: %w", err)
	}
	return &c, nil
}

func (s *SearchConnectionStore) DeleteSearchConnection(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM search_connections WHERE user_id = $1 AND id = $2`, userID, id)
	if err != nil {
		return fmt.Errorf("delete search connection: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return store.ErrSearchConnectionNotFound
	}
	return nil
}

func (s *SearchConnectionStore) SetSearchVerifyResult(ctx context.Context, userID, id uuid.UUID, verifiedAt *time.Time, lastError string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE search_connections SET verified_at = $3, last_error = $4, updated_at = now()
		WHERE user_id = $1 AND id = $2`, userID, id, verifiedAt, lastError)
	if err != nil {
		return fmt.Errorf("set search verify result: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return store.ErrSearchConnectionNotFound
	}
	return nil
}

// SearchChain returns the user's search keys WITH their decrypted secrets.
func (s *SearchConnectionStore) SearchChain(ctx context.Context, userID uuid.UUID) ([]store.SearchConnection, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+searchColumns+`, secret_enc FROM search_connections WHERE user_id = $1 ORDER BY provider`, userID)
	if err != nil {
		return nil, fmt.Errorf("search chain: %w", err)
	}
	defer rows.Close()

	out := []store.SearchConnection{}
	for rows.Next() {
		var (
			c   store.SearchConnection
			enc string
		)
		if err := rows.Scan(&c.ID, &c.UserID, &c.Provider, &c.VerifiedAt, &c.LastError, &c.CreatedAt, &enc); err != nil {
			return nil, err
		}
		plain, err := crypto.Decrypt(enc, s.encKey)
		if err != nil {
			return nil, fmt.Errorf("decrypt search secret: %w", err)
		}
		c.Secret = plain
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetSearchConnectionWithSecret reads one key, decrypted — used by verify.
func (s *SearchConnectionStore) GetSearchConnectionWithSecret(ctx context.Context, userID, id uuid.UUID) (*store.SearchConnection, error) {
	var (
		c   store.SearchConnection
		enc string
	)
	err := s.pool.QueryRow(ctx,
		`SELECT `+searchColumns+`, secret_enc FROM search_connections WHERE user_id = $1 AND id = $2`, userID, id).
		Scan(&c.ID, &c.UserID, &c.Provider, &c.VerifiedAt, &c.LastError, &c.CreatedAt, &enc)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, store.ErrSearchConnectionNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get search connection: %w", err)
	}
	plain, err := crypto.Decrypt(enc, s.encKey)
	if err != nil {
		return nil, fmt.Errorf("decrypt search secret: %w", err)
	}
	c.Secret = plain
	return &c, nil
}
