package pg

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/connectors/drive"
)

// drive_files.go — where each of a learner's files lives in their Google
// Drive, and where their "AnyTools" folders are (drive-user-storage
// phase 1).
//
// Every query is scoped by user_id, the lookups included: a digest or an
// object id is not evidence of ownership, and two learners who upload the
// same bytes have the same digest.

// DriveFileStore persists drive_files and drive_folders.
type DriveFileStore struct{ pool *Pool }

// NewDriveFileStore returns a DriveFileStore.
func NewDriveFileStore(pool *Pool) *DriveFileStore { return &DriveFileStore{pool: pool} }

var (
	_ blob.DriveIndex   = (*DriveFileStore)(nil)
	_ drive.FolderStore = (*DriveFileStore)(nil)
)

func (s *DriveFileStore) GetDriveFile(ctx context.Context, userID uuid.UUID, kind, key string) (*blob.DriveFile, error) {
	f := blob.DriveFile{UserID: userID, Kind: kind, Key: key}
	err := s.pool.QueryRow(ctx, `
		SELECT drive_file_id, sha256, bytes, mime, created_at, missing_at
		  FROM drive_files
		 WHERE user_id = $1 AND kind = $2 AND key = $3`, userID, kind, key).
		Scan(&f.DriveFileID, &f.SHA256, &f.Bytes, &f.MIME, &f.CreatedAt, &f.MissingAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, blob.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("pg: get drive file: %w", err)
	}
	return &f, nil
}

// PutDriveFile records a file's location, replacing an older one for the
// same key. A file written again is no longer missing.
func (s *DriveFileStore) PutDriveFile(ctx context.Context, f blob.DriveFile) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO drive_files (user_id, kind, key, drive_file_id, sha256, bytes, mime)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (user_id, kind, key) DO UPDATE
		   SET drive_file_id = EXCLUDED.drive_file_id,
		       sha256        = EXCLUDED.sha256,
		       bytes         = EXCLUDED.bytes,
		       mime          = EXCLUDED.mime,
		       created_at    = now(),
		       missing_at    = NULL`,
		f.UserID, f.Kind, f.Key, f.DriveFileID, f.SHA256, f.Bytes, f.MIME)
	if err != nil {
		return fmt.Errorf("pg: put drive file: %w", err)
	}
	return nil
}

func (s *DriveFileStore) DeleteDriveFile(ctx context.Context, userID uuid.UUID, kind, key string) error {
	if _, err := s.pool.Exec(ctx, `DELETE FROM drive_files WHERE user_id = $1 AND kind = $2 AND key = $3`,
		userID, kind, key); err != nil {
		return fmt.Errorf("pg: delete drive file: %w", err)
	}
	return nil
}

func (s *DriveFileStore) MarkDriveFileMissing(ctx context.Context, userID uuid.UUID, kind, key string) error {
	if _, err := s.pool.Exec(ctx, `
		UPDATE drive_files SET missing_at = now()
		 WHERE user_id = $1 AND kind = $2 AND key = $3 AND missing_at IS NULL`,
		userID, kind, key); err != nil {
		return fmt.Errorf("pg: mark drive file missing: %w", err)
	}
	return nil
}

// CountDriveFiles is how many of one learner's files are in their Drive, and
// their size (drive.FileIndex, phase 3).
func (s *DriveFileStore) CountDriveFiles(ctx context.Context, userID uuid.UUID) (int, int64, error) {
	var (
		n     int
		bytes int64
	)
	if err := s.pool.QueryRow(ctx, `
		SELECT count(*), COALESCE(sum(bytes), 0)::bigint FROM drive_files WHERE user_id = $1`,
		userID).Scan(&n, &bytes); err != nil {
		return 0, 0, fmt.Errorf("pg: count drive files: %w", err)
	}
	return n, bytes, nil
}

// ClearDriveFilesMissing forgets one learner's "removed from Drive" marks
// after a reconnect; the next read asks Drive again (phase 3).
func (s *DriveFileStore) ClearDriveFilesMissing(ctx context.Context, userID uuid.UUID) error {
	if _, err := s.pool.Exec(ctx, `
		UPDATE drive_files SET missing_at = NULL WHERE user_id = $1 AND missing_at IS NOT NULL`,
		userID); err != nil {
		return fmt.Errorf("pg: clear drive files missing: %w", err)
	}
	return nil
}

// ForgetFolders drops one learner's recorded folders, so the next
// EnsureFolders searches their Drive again (phase 3: a trashed folder).
func (s *DriveFileStore) ForgetFolders(ctx context.Context, userID uuid.UUID) error {
	if _, err := s.pool.Exec(ctx, `DELETE FROM drive_folders WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("pg: forget drive folders: %w", err)
	}
	return nil
}

// ListFolders returns role → Drive folder id for one learner.
func (s *DriveFileStore) ListFolders(ctx context.Context, userID uuid.UUID) (map[string]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT role, drive_folder_id FROM drive_folders WHERE user_id = $1`, userID)
	if err != nil {
		return nil, fmt.Errorf("pg: list drive folders: %w", err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var role, id string
		if err := rows.Scan(&role, &id); err != nil {
			return nil, err
		}
		out[role] = id
	}
	return out, rows.Err()
}

func (s *DriveFileStore) SaveFolder(ctx context.Context, userID uuid.UUID, role, folderID string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO drive_folders (user_id, role, drive_folder_id) VALUES ($1, $2, $3)
		ON CONFLICT (user_id, role) DO UPDATE SET drive_folder_id = EXCLUDED.drive_folder_id`,
		userID, role, folderID)
	if err != nil {
		return fmt.Errorf("pg: save drive folder: %w", err)
	}
	return nil
}

// Title names a file after what it belongs to, for blob.Namer: an original
// after its document, an audio overview and an exam paper after their own
// titles. A recording gets its type and no title: a worksheet's title is
// read only by the worksheet store (plan principle 5 of up-methods,
// TestOnlyTheWorksheetStoreReadsAnswers), and a private worksheet's title
// has no business in a file name anyway. An original is usually stored
// before its document row exists, so an empty answer is normal; the file is
// then named by its kind and the date.
func (s *DriveFileStore) Title(ctx context.Context, userID uuid.UUID, kind, key string) (title, mime string) {
	var query string
	switch kind {
	case blob.KindOriginal:
		query = `SELECT title, CASE WHEN media_sha256 = $2 THEN media_mime ELSE mime END FROM documents
		          WHERE user_id = $1 AND (sha256 = $2 OR media_sha256 = $2)
		          ORDER BY created_at LIMIT 1`
	case "recordings":
		query = `SELECT '', mime FROM worksheet_recordings WHERE user_id = $1 AND id::text = $2`
	case "audio":
		query = `SELECT title, '' FROM audio_overviews WHERE user_id = $1 AND id::text = $2`
	case "exam_papers":
		query = `SELECT title, '' FROM exam_templates WHERE user_id = $1 AND id::text = $2`
	default:
		return "", ""
	}
	if err := s.pool.QueryRow(ctx, query, userID, key).Scan(&title, &mime); err != nil {
		return "", ""
	}
	return title, mime
}
