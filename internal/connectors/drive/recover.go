package drive

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
)

// recover.go — what Drive storage does when the learner's Drive is not the
// way AnyTools left it (drive-user-storage phase 3): a folder they trashed or
// deleted, and a connection they took away and gave back.
//
// The rule both follow is plan decision 5: nothing is lost on either side.
// A trashed folder is never written into, and is not taken out of the trash
// either; a new one is made beside it. A reconnect copies nothing: the rows
// keep their drive_file_id, and the folders are found again by
// appProperties.

// reconnectTimeout bounds the folder checks a reconnect makes. Connect is the
// BFF's consent callback; the learner is waiting on it.
const reconnectTimeout = 30 * time.Second

// liveFolders is EnsureFolders for an upload into role: the recorded folder
// is checked first, and one the learner trashed or deleted is replaced. The
// rows are forgotten and the search runs again, so folders still alive are
// found where they are (trashed ones are not: the search asks for
// trashed = false) and only the dead ones are made anew.
func (s *Storage) liveFolders(ctx context.Context, userID uuid.UUID, role string) (map[string]string, error) {
	defer s.lockFolders(userID)()
	folders, err := s.ensureFolders(ctx, userID)
	if err != nil {
		return nil, err
	}
	id := folders[role]
	if id == "" {
		return folders, nil
	}
	alive, err := s.folderAlive(ctx, userID, id)
	if err != nil || alive {
		return folders, err
	}
	slog.Info("drive: an AnyTools folder was trashed or deleted; finding or making it again", "user", userID, "role", role)
	if err := s.folders.ForgetFolders(ctx, userID); err != nil {
		return nil, err
	}
	return s.ensureFolders(ctx, userID)
}

// folderAlive reports whether a folder is there and out of the trash. Drive
// reports a folder as trashed when its parent is, so checking the one an
// upload goes into covers a trashed "AnyTools" folder too.
func (s *Storage) folderAlive(ctx context.Context, userID uuid.UUID, id string) (bool, error) {
	if !driveID.MatchString(id) {
		return false, nil
	}
	q := url.Values{}
	q.Set("fields", "id,trashed")
	var meta driveObject
	err := s.call(ctx, userID, http.MethodGet, s.filesURL("/"+id, q), nil, &meta)
	if errors.Is(err, blob.ErrRemoved) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return !meta.Trashed, nil
}

// Reconnected runs after a learner connects Drive again. Nothing is copied:
// each drive_files row's drive_file_id works again as it is. Two things are
// put right.
//
//   - The recorded folders are checked. Any that the learner trashed or
//     deleted while disconnected, or that this account cannot see (a
//     different Google account), are forgotten and searched for again by
//     appProperties.
//   - The "removed from your Drive" marks are cleared. A file read while
//     the connection was broken, or under another account, may have been
//     marked; the next read asks Drive again, and marks it again if it
//     really is gone.
//
// A learner with nothing in Drive is not touched. Failures are logged and
// do not fail the connect: the next upload checks its folder anyway.
func (s *Storage) Reconnected(ctx context.Context, userID uuid.UUID) {
	ctx, cancel := context.WithTimeout(ctx, reconnectTimeout)
	defer cancel()
	known, err := s.folders.ListFolders(ctx, userID)
	if err != nil {
		slog.Warn("drive: reconnect could not read the recorded folders", "error", err, "user", userID)
		return
	}
	files := 0
	if s.files != nil {
		if files, _, err = s.files.CountDriveFiles(ctx, userID); err != nil {
			slog.Warn("drive: reconnect could not count the files in Drive", "error", err, "user", userID)
			return
		}
		if files > 0 {
			if err := s.files.ClearDriveFilesMissing(ctx, userID); err != nil {
				slog.Warn("drive: reconnect could not clear the missing marks", "error", err, "user", userID)
			}
		}
	}
	if len(known) == 0 && files == 0 {
		return
	}

	unlock := s.lockFolders(userID)
	defer unlock()
	for _, role := range blob.FolderRoles {
		id := known[role]
		if id == "" {
			continue
		}
		alive, err := s.folderAlive(ctx, userID, id)
		if err != nil {
			slog.Warn("drive: reconnect could not check a folder", "error", err, "user", userID, "role", role)
			return
		}
		if !alive {
			if err := s.folders.ForgetFolders(ctx, userID); err != nil {
				slog.Warn("drive: reconnect could not forget the folders", "error", err, "user", userID)
				return
			}
			break
		}
	}
	if _, err := s.ensureFolders(ctx, userID); err != nil {
		slog.Warn("drive: reconnect could not find the AnyTools folders", "error", err, "user", userID)
	}
}

// usage is how many of the learner's files are in their Drive, for Status.
func (s *Storage) usage(ctx context.Context, userID uuid.UUID) (int, int64, error) {
	if s.files == nil {
		return 0, 0, nil
	}
	return s.files.CountDriveFiles(ctx, userID)
}
