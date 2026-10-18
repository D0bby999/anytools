package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/blob"
)

// drive_moves.go — what moving a learner's files needs from drive_files and
// from the jobs table (drive-user-storage phase 2). Every query is scoped by
// user_id, like the rest of drive_files.go.

var _ blob.MoveIndex = (*DriveFileStore)(nil)

// ListDriveFiles lists one learner's rows, oldest first.
func (s *DriveFileStore) ListDriveFiles(ctx context.Context, userID uuid.UUID) ([]blob.DriveFile, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT kind, key, drive_file_id, sha256, bytes, mime, created_at, missing_at
		  FROM drive_files
		 WHERE user_id = $1
		 ORDER BY created_at, kind, key`, userID)
	if err != nil {
		return nil, fmt.Errorf("pg: list drive files: %w", err)
	}
	defer rows.Close()
	var out []blob.DriveFile
	for rows.Next() {
		f := blob.DriveFile{UserID: userID}
		if err := rows.Scan(&f.Kind, &f.Key, &f.DriveFileID, &f.SHA256, &f.Bytes, &f.MIME, &f.CreatedAt, &f.MissingAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// InsertDriveFile records a file only if it has no row yet.
func (s *DriveFileStore) InsertDriveFile(ctx context.Context, f blob.DriveFile) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO drive_files (user_id, kind, key, drive_file_id, sha256, bytes, mime)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (user_id, kind, key) DO NOTHING`,
		f.UserID, f.Kind, f.Key, f.DriveFileID, f.SHA256, f.Bytes, f.MIME)
	if err != nil {
		return false, fmt.Errorf("pg: insert drive file: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// DeleteDriveFileIf removes a row only while it still names fileID.
func (s *DriveFileStore) DeleteDriveFileIf(ctx context.Context, userID uuid.UUID, kind, key, fileID string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM drive_files
		 WHERE user_id = $1 AND kind = $2 AND key = $3 AND drive_file_id = $4`,
		userID, kind, key, fileID)
	if err != nil {
		return false, fmt.Errorf("pg: delete drive file: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// DriveUsage is what one learner keeps in their Drive, by AnyTools' record.
type DriveUsage struct {
	Files   int64
	Bytes   int64
	Missing int64
}

// DriveUsage counts one learner's rows; a file removed from Drive is counted
// apart and not in Bytes.
func (s *DriveFileStore) DriveUsage(ctx context.Context, userID uuid.UUID) (DriveUsage, error) {
	var u DriveUsage
	err := s.pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE missing_at IS NULL),
		       coalesce(sum(bytes) FILTER (WHERE missing_at IS NULL), 0),
		       count(*) FILTER (WHERE missing_at IS NOT NULL)
		  FROM drive_files
		 WHERE user_id = $1`, userID).Scan(&u.Files, &u.Bytes, &u.Missing)
	if err != nil {
		return DriveUsage{}, fmt.Errorf("pg: drive usage: %w", err)
	}
	return u, nil
}

// StorageMove is a learner's latest storage_move job.
type StorageMove struct {
	ID              uuid.UUID
	Status          string
	Payload         json.RawMessage
	Progress        json.RawMessage
	LastError       string
	CancelRequested bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// LatestStorageMove returns the learner's most recent storage_move job, or
// nil when they never started one.
func (s *DriveFileStore) LatestStorageMove(ctx context.Context, userID uuid.UUID, kind string) (*StorageMove, error) {
	var m StorageMove
	err := s.pool.QueryRow(ctx, `
		SELECT id, status, payload, progress, coalesce(last_error, ''), cancel_requested, created_at, updated_at
		  FROM jobs
		 WHERE user_id = $1 AND kind = $2
		 ORDER BY created_at DESC
		 LIMIT 1`, userID, kind).
		Scan(&m.ID, &m.Status, &m.Payload, &m.Progress, &m.LastError, &m.CancelRequested, &m.CreatedAt, &m.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("pg: latest storage move: %w", err)
	}
	return &m, nil
}
