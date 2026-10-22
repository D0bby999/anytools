package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/D0bby999/anytools/internal/showcase"
)

// ShowcaseStore is learners' public profiles (internal/showcase).
type ShowcaseStore struct{ pool *Pool }

// NewShowcaseStore builds a ShowcaseStore.
func NewShowcaseStore(pool *Pool) *ShowcaseStore { return &ShowcaseStore{pool: pool} }

var _ showcase.Store = (*ShowcaseStore)(nil)

const showcaseColumns = `handle, display_name, headline, published, indexed, design, updated_at`

func scanShowcase(row pgx.Row, extra ...any) (*showcase.Stored, error) {
	var st showcase.Stored
	err := row.Scan(append(extra, &st.Handle, &st.Name, &st.Headline, &st.Published, &st.Indexed, &st.Design, &st.UpdatedAt)...)
	if err != nil {
		return nil, err
	}
	return &st, nil
}

// Get implements showcase.Store.
func (s *ShowcaseStore) Get(ctx context.Context, user uuid.UUID) (*showcase.Stored, error) {
	st, err := scanShowcase(s.pool.QueryRow(ctx, `SELECT `+showcaseColumns+` FROM public_profiles WHERE user_id = $1`, user))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("showcase get: %w", err)
	}
	return st, nil
}

// Published implements showcase.Store.
func (s *ShowcaseStore) Published(ctx context.Context, handle string) (uuid.UUID, *showcase.Stored, error) {
	var user uuid.UUID
	st, err := scanShowcase(s.pool.QueryRow(ctx,
		`SELECT user_id, `+showcaseColumns+` FROM public_profiles WHERE handle = $1 AND published`, handle), &user)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, nil, showcase.ErrNotFound
	}
	if err != nil {
		return uuid.Nil, nil, fmt.Errorf("showcase read: %w", err)
	}
	return user, st, nil
}

// Save implements showcase.Store.
func (s *ShowcaseStore) Save(ctx context.Context, user uuid.UUID, p showcase.Profile, design []byte) (time.Time, error) {
	var at time.Time
	err := s.pool.QueryRow(ctx, `
		INSERT INTO public_profiles (user_id, handle, display_name, headline, published, indexed, design)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (user_id) DO UPDATE
		   SET handle = EXCLUDED.handle, display_name = EXCLUDED.display_name,
		       headline = EXCLUDED.headline, published = EXCLUDED.published,
		       indexed = EXCLUDED.indexed, design = EXCLUDED.design, updated_at = now()
		RETURNING updated_at`,
		user, p.Handle, p.Name, p.Headline, p.Published, p.Indexed, design).Scan(&at)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return time.Time{}, showcase.ErrHandleTaken
	}
	if err != nil {
		return time.Time{}, fmt.Errorf("showcase save: %w", err)
	}
	return at, nil
}

// Delete implements showcase.Store.
func (s *ShowcaseStore) Delete(ctx context.Context, user uuid.UUID) error {
	if _, err := s.pool.Exec(ctx, `DELETE FROM public_profiles WHERE user_id = $1`, user); err != nil {
		return fmt.Errorf("showcase delete: %w", err)
	}
	return nil
}

// Listed implements showcase.Store.
func (s *ShowcaseStore) Listed(ctx context.Context, limit int) ([]showcase.Listed, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT handle, updated_at FROM public_profiles
		 WHERE published AND indexed ORDER BY updated_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("showcase listed: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (showcase.Listed, error) {
		var l showcase.Listed
		err := row.Scan(&l.Handle, &l.UpdatedAt)
		return l, err
	})
}
