package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/storageapi"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/connectors/gdocs"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// wire_storage.go — Settings → Storage (drive-user-storage phase 2): the
// learner's choice of where their files are kept, the job that moves the
// existing ones, and "Save to my Drive" for exports.
//
// The router reads the choice (blob.StorageChoice, in buildKnowledge); this
// file builds the routes and the move job over the same Drive backend.

// buildStorage returns Settings → Storage's routes. Without a Drive backend
// (no Google OAuth client) they still answer, with the server as the only
// choice, and no move job is registered.
func buildStorage(pool *pg.Pool, kb knowledgeSubsystem, dc *driveConnector, users *pg.UserStore) *storageapi.Handler {
	index := pg.NewDriveFileStore(pool)
	var files storageapi.DriveFiles
	if kb.driveFiles != nil && dc != nil {
		files = driveFilesAdapter{drive: kb.driveFiles, index: index, conns: dc.store}
		// One move at a time, on a worker of its own: a move is hours of
		// I/O for a large library, and must not hold up anyone's parsing.
		if kb.soloHandlers != nil {
			kb.soloHandlers[storageapi.JobKind] = storageMoveHandler(kb.queue, kb.driveFiles)
		}
	}
	h := storageapi.NewHandler(users, files, storageMoves{queue: kb.queue, index: index})
	if dc != nil {
		// Learning-tool-connections phase 7: "Send to NotebookLM".
		h.WithSink("notebooklm", docWriter{gdocs.NewService(dc.svc)})
	}
	return h
}

// docWriter adapts gdocs to the export sink, in the sink's own error words.
type docWriter struct{ docs *gdocs.Service }

func (d docWriter) CreateDoc(ctx context.Context, userID uuid.UUID, name, markdown string) (string, string, string, error) {
	doc, err := d.docs.Create(ctx, userID, name, markdown)
	switch {
	case errors.Is(err, drive.ErrNotConnected):
		return "", "", "", storageapi.ErrDriveNotConnected
	case errors.Is(err, drive.ErrNeedsReconnect), errors.Is(err, drive.ErrScopeMissing):
		return "", "", "", storageapi.ErrDriveReconnect
	case err != nil:
		return "", "", "", err
	}
	return doc.ID, doc.Name, doc.URL, nil
}

// fileStorageOf is the router's reading of the learner's choice. Account
// deletion asks the router to delete the learner's files after their row is
// gone (internal/account), so a learner who no longer exists is on the
// server: the router has then already asked every backend, and the Drive
// backend deletes only its cache (owner decision 1).
func fileStorageOf(users *pg.UserStore) blob.StorageSetting {
	return func(ctx context.Context, userID uuid.UUID) (string, error) {
		s, err := users.FileStorage(ctx, userID)
		if errors.Is(err, store.ErrUserNotFound) {
			return blob.StorageServer, nil
		}
		return s, err
	}
}

// storageMoveHandler runs a move one file per unit (jobs.RunUnits), so a
// retry resumes at the first file not yet moved and a cancel stops after the
// file in flight. A Drive that needs reconnecting or is full stops the move
// at once; any other failure is retried once, from the same file.
func storageMoveHandler(queue *jobs.Queue, files *blob.Drive) jobs.Handler {
	return func(ctx context.Context, job *jobs.Job) error {
		var p storageapi.MovePayload
		if err := json.Unmarshal(job.Payload, &p); err != nil || !p.Direction.Valid() {
			return jobs.Terminal(errors.New("storage move: unreadable plan"))
		}
		return queue.RunUnits(ctx, job, len(p.Items), func(ctx context.Context, i int) (int, error) {
			_, err := files.MoveOne(ctx, job.UserID, p.Direction, p.Items[i])
			if err == nil {
				return 0, nil
			}
			if code := storageapi.MoveError(driveError(err)); code != "" {
				return 0, jobs.Terminal(fmt.Errorf("%s: %w", code, err))
			}
			return 0, err
		})
	}
}

// driveError translates the connector's refusals into storageapi's.
func driveError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, drive.ErrNotConnected):
		return fmt.Errorf("%w: %w", storageapi.ErrDriveNotConnected, err)
	case errors.Is(err, drive.ErrNeedsReconnect):
		return fmt.Errorf("%w: %w", storageapi.ErrDriveReconnect, err)
	case drive.QuotaExceeded(err):
		return fmt.Errorf("%w: %w", storageapi.ErrDriveFull, err)
	}
	return err
}

// driveFilesAdapter is the Drive backend and the learner's connection as
// storageapi sees them.
type driveFilesAdapter struct {
	drive *blob.Drive
	index *pg.DriveFileStore
	conns *pg.DriveStore
}

func (a driveFilesAdapter) Ready(ctx context.Context, userID uuid.UUID) error {
	conn, err := a.conns.GetConnection(ctx, userID)
	if errors.Is(err, drive.ErrNotConnected) {
		return storageapi.ErrDriveNotConnected
	}
	if err != nil {
		return err
	}
	if conn.NeedsReconnect {
		return storageapi.ErrDriveReconnect
	}
	return nil
}

func (a driveFilesAdapter) EnsureFolders(ctx context.Context, userID uuid.UUID) error {
	return driveError(a.drive.EnsureFolders(ctx, userID))
}

func (a driveFilesAdapter) PlanMove(ctx context.Context, userID uuid.UUID, dir blob.MoveDirection) ([]blob.MoveItem, error) {
	return a.drive.PlanMove(ctx, userID, dir)
}

func (a driveFilesAdapter) SaveExport(ctx context.Context, userID uuid.UUID, key, name, mimeType string, data []byte) (string, error) {
	id, err := a.drive.SaveExport(ctx, userID, key, name, mimeType, data)
	return id, driveError(err)
}

// Usage counts the learner's own files on the server's disk and their rows
// in Drive.
func (a driveFilesAdapter) Usage(ctx context.Context, userID uuid.UUID) (storageapi.Usage, error) {
	var u storageapi.Usage
	onServer, err := a.drive.PlanMove(ctx, userID, blob.MoveToDrive)
	if err != nil {
		return u, err
	}
	for _, it := range onServer {
		u.ServerFiles++
		u.ServerBytes += it.Bytes
	}
	inDrive, err := a.index.DriveUsage(ctx, userID)
	if err != nil {
		return u, err
	}
	u.DriveFiles, u.DriveBytes, u.DriveMissing = inDrive.Files, inDrive.Bytes, inDrive.Missing
	return u, nil
}

// storageMoves is the job queue, for the move job.
type storageMoves struct {
	queue *jobs.Queue
	index *pg.DriveFileStore
}

func (m storageMoves) Enqueue(ctx context.Context, userID uuid.UUID, kind string, payload any, maxAttempts int) (uuid.UUID, error) {
	return m.queue.Enqueue(ctx, userID, kind, payload, maxAttempts)
}

func (m storageMoves) RequestCancel(ctx context.Context, userID, jobID uuid.UUID) (bool, error) {
	return m.queue.RequestCancel(ctx, userID, jobID)
}

func (m storageMoves) Latest(ctx context.Context, userID uuid.UUID) (*storageapi.MoveJob, error) {
	j, err := m.index.LatestStorageMove(ctx, userID, storageapi.JobKind)
	if err != nil || j == nil {
		return nil, err
	}
	return &storageapi.MoveJob{ID: j.ID, Status: j.Status, Payload: j.Payload, Progress: j.Progress,
		LastError: j.LastError, CancelRequested: j.CancelRequested}, nil
}
