package pg

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/store"
)

// file_storage.go — users.file_storage, where a learner's own files are
// written (drive-user-storage phase 2). The router reads it on every write.

// FileStorage returns "server" or "drive".
func (s *UserStore) FileStorage(ctx context.Context, id uuid.UUID) (string, error) {
	var v string
	err := s.pool.QueryRow(ctx, `SELECT file_storage FROM users WHERE id = $1 AND deleted_at IS NULL`, id).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", store.ErrUserNotFound
	}
	if err != nil {
		return "", fmt.Errorf("file storage: %w", err)
	}
	return v, nil
}

// SetFileStorage stores the learner's choice. The column's CHECK refuses
// anything but "server" and "drive".
func (s *UserStore) SetFileStorage(ctx context.Context, id uuid.UUID, storage string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE users SET file_storage = $2, updated_at = now()
		 WHERE id = $1 AND deleted_at IS NULL`, id, storage)
	if err != nil {
		return fmt.Errorf("set file storage: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return store.ErrUserNotFound
	}
	return nil
}
