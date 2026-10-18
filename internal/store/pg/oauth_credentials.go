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

// OAuthCredentialStore persists the subscription lanes' token pairs.
//
// Both tokens go through encryptOrFail. That matters more here than anywhere
// else in the codebase: a Gemini Code Assist refresh token carries
// `cloud-platform` scope, so it is a full Google Cloud credential for that user
// — Storage, BigQuery, Compute, Secret Manager — not an AI quota (spike A,
// "Impersonation + ToS exposure"). Storing one unencrypted would be the worst
// single row in the database.
type OAuthCredentialStore struct {
	pool   *Pool
	encKey string
}

func NewOAuthCredentialStore(pool *Pool, encKey string) *OAuthCredentialStore {
	return &OAuthCredentialStore{pool: pool, encKey: encKey}
}

var _ store.OAuthCredentialStore = (*OAuthCredentialStore)(nil)

// ErrOAuthCredentialNotFound is returned when the connection has no token pair.
var ErrOAuthCredentialNotFound = errors.New("pg: oauth credential not found")

func (s *OAuthCredentialStore) GetOAuthCredential(ctx context.Context, userID, connectionID uuid.UUID) (*store.OAuthCredential, error) {
	var (
		c                 store.OAuthCredential
		accessEnc, refEnc string
	)
	err := s.pool.QueryRow(ctx, `
		SELECT connection_id, user_id, access_enc, refresh_enc, expires_at, rotated_at
		FROM oauth_credentials
		WHERE user_id = $1 AND connection_id = $2`, userID, connectionID).
		Scan(&c.ConnectionID, &c.UserID, &accessEnc, &refEnc, &c.ExpiresAt, &c.RotatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOAuthCredentialNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get oauth credential: %w", err)
	}

	if c.AccessToken, err = decryptIfPresent(accessEnc, s.encKey, "access"); err != nil {
		return nil, err
	}
	if c.RefreshToken, err = decryptIfPresent(refEnc, s.encKey, "refresh"); err != nil {
		return nil, err
	}
	return &c, nil
}

// SaveOAuthCredential writes the pair, replacing whatever was there.
//
// rotated_at is set on every write because a rotating provider (both lanes
// rotate) mints a NEW refresh token on each refresh and invalidates the old
// one: the timestamp is how a support question about "which token is live"
// gets an answer that does not require reading the secret.
func (s *OAuthCredentialStore) SaveOAuthCredential(ctx context.Context, userID, connectionID uuid.UUID, access, refresh string, expiresAt *time.Time) error {
	accessEnc, err := encryptOrFail(access, s.encKey, "oauth_credentials.access_enc")
	if err != nil {
		return err
	}
	refEnc, err := encryptOrFail(refresh, s.encKey, "oauth_credentials.refresh_enc")
	if err != nil {
		return err
	}

	_, err = s.pool.Exec(ctx, `
		INSERT INTO oauth_credentials (connection_id, user_id, access_enc, refresh_enc, expires_at, rotated_at)
		VALUES ($1, $2, $3, $4, $5, now())
		ON CONFLICT (connection_id) DO UPDATE SET
			access_enc  = EXCLUDED.access_enc,
			-- An empty refresh means "the provider did not mint a new one";
			-- keep the one we hold rather than blanking a live credential.
			refresh_enc = CASE WHEN EXCLUDED.refresh_enc = '' THEN oauth_credentials.refresh_enc
			                   ELSE EXCLUDED.refresh_enc END,
			expires_at  = EXCLUDED.expires_at,
			rotated_at  = now()`,
		connectionID, userID, accessEnc, refEnc, expiresAt)
	if err != nil {
		return fmt.Errorf("save oauth credential: %w", err)
	}
	return nil
}

func decryptIfPresent(value, key, field string) (string, error) {
	if value == "" {
		return "", nil
	}
	plain, err := crypto.Decrypt(value, key)
	if err != nil {
		return "", fmt.Errorf("decrypt oauth %s token: %w", field, err)
	}
	return plain, nil
}
