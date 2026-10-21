package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/connectors/appconn"
)

// AppConnStore is app_connections (learning-tool-connections phases 8, 9).
type AppConnStore struct {
	pool   *Pool
	encKey string
}

// NewAppConnStore returns an AppConnStore.
func NewAppConnStore(pool *Pool, encKey string) *AppConnStore {
	return &AppConnStore{pool: pool, encKey: encKey}
}

func clip(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

// Get returns a learner's grant to an app, or appconn.ErrNotConnected.
func (s *AppConnStore) Get(ctx context.Context, userID uuid.UUID, provider string) (*appconn.Connection, error) {
	c := appconn.Connection{UserID: userID, Provider: provider}
	var refreshEnc, accessEnc string
	err := s.pool.QueryRow(ctx, `
        SELECT refresh_enc, access_enc, expires_at, scope, account_label, needs_reconnect, last_error, connected_at
          FROM app_connections WHERE user_id = $1 AND provider = $2`, userID, provider).
		Scan(&refreshEnc, &accessEnc, &c.ExpiresAt, &c.Scope, &c.AccountLabel, &c.NeedsReconnect, &c.LastError, &c.ConnectedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, appconn.ErrNotConnected
	}
	if err != nil {
		return nil, fmt.Errorf("pg: read app connection: %w", err)
	}
	if c.RefreshToken, err = decryptIfPresent(refreshEnc, s.encKey, "app refresh"); err != nil {
		return nil, err
	}
	if c.AccessToken, err = decryptIfPresent(accessEnc, s.encKey, "app access"); err != nil {
		return nil, err
	}
	return &c, nil
}

// Save writes a fresh grant, clearing any reconnect mark.
func (s *AppConnStore) Save(ctx context.Context, c appconn.Connection) error {
	refreshEnc, err := encryptOrFail(c.RefreshToken, s.encKey, "app_connections.refresh_enc")
	if err != nil {
		return err
	}
	accessEnc, err := encryptOrFail(c.AccessToken, s.encKey, "app_connections.access_enc")
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
        INSERT INTO app_connections (user_id, provider, refresh_enc, access_enc, expires_at, scope, account_label, connected_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, now())
        ON CONFLICT (user_id, provider) DO UPDATE SET
            refresh_enc = EXCLUDED.refresh_enc, access_enc = EXCLUDED.access_enc, expires_at = EXCLUDED.expires_at,
            scope = EXCLUDED.scope, account_label = EXCLUDED.account_label,
            needs_reconnect = false, last_error = '', connected_at = now(), updated_at = now()`,
		c.UserID, c.Provider, refreshEnc, accessEnc, c.ExpiresAt, clip(c.Scope, 2000), clip(c.AccountLabel, 300))
	if err != nil {
		return fmt.Errorf("pg: save app connection: %w", err)
	}
	return nil
}

// SaveTokens stores a refresh's result.
func (s *AppConnStore) SaveTokens(ctx context.Context, userID uuid.UUID, provider, access, refresh string, expiresAt *time.Time) error {
	refreshEnc, err := encryptOrFail(refresh, s.encKey, "app_connections.refresh_enc")
	if err != nil {
		return err
	}
	accessEnc, err := encryptOrFail(access, s.encKey, "app_connections.access_enc")
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
        UPDATE app_connections SET refresh_enc = $3, access_enc = $4, expires_at = $5, updated_at = now()
         WHERE user_id = $1 AND provider = $2`, userID, provider, refreshEnc, accessEnc, expiresAt)
	return err
}

// MarkNeedsReconnect records a grant the app stopped honouring.
func (s *AppConnStore) MarkNeedsReconnect(ctx context.Context, userID uuid.UUID, provider, reason string) error {
	_, err := s.pool.Exec(ctx, `
        UPDATE app_connections SET needs_reconnect = true, last_error = $3, updated_at = now()
         WHERE user_id = $1 AND provider = $2`, userID, provider, clip(reason, 500))
	return err
}

// Delete forgets a grant.
func (s *AppConnStore) Delete(ctx context.Context, userID uuid.UUID, provider string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM app_connections WHERE user_id = $1 AND provider = $2`, userID, provider)
	return err
}
