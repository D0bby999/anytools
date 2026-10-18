package pg

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/D0bby999/anytools/internal/crypto"
	"github.com/D0bby999/anytools/internal/store"
)

// FunctionRouteStore is the pgx implementation of store.FunctionRouteStore.
type FunctionRouteStore struct {
	pool   *Pool
	encKey string
}

func NewFunctionRouteStore(pool *Pool, encKey string) *FunctionRouteStore {
	return &FunctionRouteStore{pool: pool, encKey: encKey}
}

var _ store.FunctionRouteStore = (*FunctionRouteStore)(nil)

func (s *FunctionRouteStore) ListRoutes(ctx context.Context, userID uuid.UUID) ([]store.FunctionRoute, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, "function", position, connection_id, model, COALESCE(dims, 0)
		FROM function_routes
		WHERE user_id = $1
		ORDER BY "function", position`, userID)
	if err != nil {
		return nil, fmt.Errorf("list routes: %w", err)
	}
	defer rows.Close()

	out := []store.FunctionRoute{}
	for rows.Next() {
		var r store.FunctionRoute
		if err := rows.Scan(&r.ID, &r.UserID, &r.Function, &r.Position, &r.ConnectionID, &r.Model, &r.Dims); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ReplaceRoute swaps one function's whole chain inside a transaction.
//
// Delete-then-insert rather than a diff, for a reason the unique index makes
// unavoidable: (user_id, function, position) is unique, so "swap entries 0 and
// 1" as two updates transiently collides no matter which order they run in.
// Inside one transaction the intermediate state is never visible.
func (s *FunctionRouteStore) ReplaceRoute(ctx context.Context, userID uuid.UUID, function string, entries []store.RouteEntryInput) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op

	if _, err := tx.Exec(ctx,
		`DELETE FROM function_routes WHERE user_id = $1 AND "function" = $2`, userID, function); err != nil {
		return fmt.Errorf("clear route: %w", err)
	}

	for i, e := range entries {
		var dims any
		if e.Dims > 0 {
			dims = e.Dims
		}
		// user_id is written from the authenticated caller and the composite
		// foreign key (user_id, connection_id) then refuses any connection that
		// user does not own. A route pointing at someone else's key is not a
		// bug this code can have; it is a row the database will not accept.
		if _, err := tx.Exec(ctx, `
			INSERT INTO function_routes (user_id, "function", position, connection_id, model, dims)
			VALUES ($1, $2, $3, $4, $5, $6)`,
			userID, function, i, e.ConnectionID, e.Model, dims); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.ConstraintName == "function_routes_connection_same_user" {
				return store.ErrConnectionNotFound
			}
			return fmt.Errorf("insert route entry %d: %w", i, err)
		}
	}
	return tx.Commit(ctx)
}

// ChainFor returns the function's chain joined to its connections, WITH
// decrypted secrets. It is the one read in this file that decrypts, and its
// only caller is internal/byok.
func (s *FunctionRouteStore) ChainFor(ctx context.Context, userID uuid.UUID, function string) ([]store.ChainEntry, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT r.position, r.model, COALESCE(r.dims, 0),
		       c.id, c.user_id, c.provider, c.kind, c.name, c.api_base, c.settings,
		       c.verified_at, c.last_error, c.created_at, c.updated_at, c.secret_enc
		FROM function_routes r
		JOIN provider_connections c ON c.id = r.connection_id AND c.user_id = r.user_id
		WHERE r.user_id = $1 AND r."function" = $2
		ORDER BY r.position`, userID, function)
	if err != nil {
		return nil, fmt.Errorf("chain for %s: %w", function, err)
	}
	defer rows.Close()

	out := []store.ChainEntry{}
	for rows.Next() {
		var (
			e         store.ChainEntry
			settings  []byte
			secretEnc string
		)
		if err := rows.Scan(&e.Position, &e.Model, &e.Dims,
			&e.Connection.ID, &e.Connection.UserID, &e.Connection.Provider, &e.Connection.Kind,
			&e.Connection.Name, &e.Connection.APIBase, &settings,
			&e.Connection.VerifiedAt, &e.Connection.LastError,
			&e.Connection.CreatedAt, &e.Connection.UpdatedAt, &secretEnc); err != nil {
			return nil, err
		}
		if err := decodeSettingsInto(settings, &e.Connection); err != nil {
			return nil, err
		}
		e.Connection.HasSecret = secretEnc != ""
		if secretEnc != "" {
			plain, err := crypto.Decrypt(secretEnc, s.encKey)
			if err != nil {
				return nil, fmt.Errorf("decrypt connection secret: %w", err)
			}
			e.Connection.Secret = plain
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
