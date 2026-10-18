package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/D0bby999/anytools/internal/crypto"
	"github.com/D0bby999/anytools/internal/store"
)

const constraintConnectionNameUnique = "provider_connections_name_unique"

// ProviderConnectionStore is the pgx implementation of
// store.ProviderConnectionStore.
type ProviderConnectionStore struct {
	pool   *Pool
	encKey string
}

// NewProviderConnectionStore builds the store. encKey is required: every write
// path here goes through encryptOrFail, which refuses rather than storing a
// secret in the clear.
func NewProviderConnectionStore(pool *Pool, encKey string) *ProviderConnectionStore {
	return &ProviderConnectionStore{pool: pool, encKey: encKey}
}

var _ store.ProviderConnectionStore = (*ProviderConnectionStore)(nil)

// connectionColumns deliberately lists secret_enc LAST and every read that is
// not allowed to decrypt simply scans it into a discard target — see scanRow.
const connectionColumns = `id, user_id, provider, kind, name, api_base, settings,
	verified_at, last_error, created_at, updated_at, secret_enc`

func (s *ProviderConnectionStore) CreateConnection(ctx context.Context, userID uuid.UUID, in store.NewProviderConnection) (*store.ProviderConnection, error) {
	secretEnc, err := encryptOrFail(in.Secret, s.encKey, "provider_connections.secret_enc")
	if err != nil {
		return nil, err
	}
	settings, err := json.Marshal(in.Settings)
	if err != nil {
		return nil, fmt.Errorf("marshal connection settings: %w", err)
	}

	row := s.pool.QueryRow(ctx, `
		INSERT INTO provider_connections (user_id, provider, kind, name, api_base, secret_enc, settings)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING `+connectionColumns,
		userID, in.Provider, in.Kind, in.Name, in.APIBase, secretEnc, settings)

	conn, err := scanConnection(row, false, s.encKey)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.ConstraintName == constraintConnectionNameUnique {
			return nil, store.ErrDuplicateConnectionName
		}
		return nil, err
	}
	return conn, nil
}

func (s *ProviderConnectionStore) ListConnections(ctx context.Context, userID uuid.UUID) ([]store.ProviderConnection, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+connectionColumns+`
		FROM provider_connections
		WHERE user_id = $1
		ORDER BY created_at`, userID)
	if err != nil {
		return nil, fmt.Errorf("list connections: %w", err)
	}
	defer rows.Close()

	out := []store.ProviderConnection{}
	for rows.Next() {
		conn, err := scanConnection(rows, false, s.encKey)
		if err != nil {
			return nil, err
		}
		out = append(out, *conn)
	}
	return out, rows.Err()
}

func (s *ProviderConnectionStore) GetConnection(ctx context.Context, userID, id uuid.UUID) (*store.ProviderConnection, error) {
	return s.get(ctx, userID, id, false)
}

func (s *ProviderConnectionStore) GetConnectionWithSecret(ctx context.Context, userID, id uuid.UUID) (*store.ProviderConnection, error) {
	return s.get(ctx, userID, id, true)
}

func (s *ProviderConnectionStore) get(ctx context.Context, userID, id uuid.UUID, decrypt bool) (*store.ProviderConnection, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT `+connectionColumns+`
		FROM provider_connections
		WHERE user_id = $1 AND id = $2`, userID, id)

	conn, err := scanConnection(row, decrypt, s.encKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, store.ErrConnectionNotFound
	}
	return conn, err
}

func (s *ProviderConnectionStore) UpdateConnection(ctx context.Context, userID, id uuid.UUID, in store.ConnectionUpdate) (*store.ProviderConnection, error) {
	// COALESCE against a nullable parameter, rather than composing SQL from
	// whichever fields are set: a hand-built SET list is how a column name ends
	// up interpolated from caller input.
	var secretEnc *string
	if in.Secret != nil {
		enc, err := encryptOrFail(*in.Secret, s.encKey, "provider_connections.secret_enc")
		if err != nil {
			return nil, err
		}
		secretEnc = &enc
	}

	row := s.pool.QueryRow(ctx, `
		UPDATE provider_connections SET
			name       = COALESCE($3, name),
			api_base   = COALESCE($4, api_base),
			secret_enc = COALESCE($5, secret_enc),
			-- A new key invalidates whatever the old one proved.
			verified_at = CASE WHEN $5::text IS NULL THEN verified_at ELSE NULL END,
			last_error  = CASE WHEN $5::text IS NULL THEN last_error  ELSE '' END,
			settings    = CASE WHEN $5::text IS NULL THEN settings
			                   ELSE settings - 'verify_status' - 'verified_model'
			                                 - 'cooldown_until' - 'backoff_level' - 'cooldown_reason' END,
			updated_at = now()
		WHERE user_id = $1 AND id = $2
		RETURNING `+connectionColumns,
		userID, id, in.Name, in.APIBase, secretEnc)

	conn, err := scanConnection(row, false, s.encKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, store.ErrConnectionNotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.ConstraintName == constraintConnectionNameUnique {
		return nil, store.ErrDuplicateConnectionName
	}
	return conn, err
}

func (s *ProviderConnectionStore) DeleteConnection(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM provider_connections WHERE user_id = $1 AND id = $2`, userID, id)
	if err != nil {
		return fmt.Errorf("delete connection: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return store.ErrConnectionNotFound
	}
	return nil
}

func (s *ProviderConnectionStore) MergeConnectionSettings(ctx context.Context, userID, id uuid.UUID, patch json.RawMessage) error {
	// `||` is a SHALLOW merge, which is exactly the semantics wanted: the chain
	// writes cooldown keys, verify writes status keys, and neither erases the
	// other's. Replacing the whole object from a read-modify-write would.
	tag, err := s.pool.Exec(ctx, `
		UPDATE provider_connections
		SET settings = settings || $3::jsonb, updated_at = now()
		WHERE user_id = $1 AND id = $2`, userID, id, []byte(patch))
	if err != nil {
		return fmt.Errorf("merge connection settings: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return store.ErrConnectionNotFound
	}
	return nil
}

// SetVerifyResult records the outcome of a verify ping. Kept beside the merge
// above rather than folded into it because verified_at and last_error are real
// columns the list endpoint reads.
func (s *ProviderConnectionStore) SetVerifyResult(ctx context.Context, userID, id uuid.UUID, verifiedAt *time.Time, lastError string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE provider_connections
		SET verified_at = $3, last_error = $4, updated_at = now()
		WHERE user_id = $1 AND id = $2`, userID, id, verifiedAt, lastError)
	if err != nil {
		return fmt.Errorf("set verify result: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return store.ErrConnectionNotFound
	}
	return nil
}

// rowScanner is the shape pgx.Row and pgx.Rows share.
type rowScanner interface{ Scan(dest ...any) error }

// scanConnection reads one row. When decrypt is false the ciphertext is read
// (so HasSecret can be reported) but never decrypted, and Secret stays empty —
// the caller therefore cannot leak what it does not hold.
func scanConnection(row rowScanner, decrypt bool, encKey string) (*store.ProviderConnection, error) {
	var (
		c         store.ProviderConnection
		settings  []byte
		secretEnc string
	)
	if err := row.Scan(&c.ID, &c.UserID, &c.Provider, &c.Kind, &c.Name, &c.APIBase,
		&settings, &c.VerifiedAt, &c.LastError, &c.CreatedAt, &c.UpdatedAt, &secretEnc); err != nil {
		return nil, err
	}
	if err := decodeSettingsInto(settings, &c); err != nil {
		return nil, err
	}
	c.HasSecret = secretEnc != ""
	if decrypt && secretEnc != "" {
		plain, err := crypto.Decrypt(secretEnc, encKey)
		if err != nil {
			return nil, fmt.Errorf("decrypt connection secret: %w", err)
		}
		c.Secret = plain
	}
	return &c, nil
}

// decodeSettingsInto is shared by the single-row scanner above and the chain
// join in function_routes.go, so the two cannot disagree about what an empty
// settings column means.
func decodeSettingsInto(raw []byte, c *store.ProviderConnection) error {
	if len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, &c.Settings); err != nil {
		return fmt.Errorf("decode connection settings: %w", err)
	}
	return nil
}
