package blob

import (
	"context"
	"errors"
	"io"
	"log/slog"

	"github.com/google/uuid"
)

// choice.go — the learner's choice of where their files are kept, read by
// the router (drive-user-storage phase 2).
//
// New writes go where the learner chose. Reads and deletes follow each
// file's recorded location instead, whatever the choice: a file with a
// drive_files row is in Drive, a file without one is on the server. A
// learner part way through a move, in either direction, therefore reads
// every file from wherever it is at that moment.
//
// Drive storage is opt-in (owner decision 2): the choice is "server" until
// the learner turns Drive on in Settings → Storage, connected or not.

// Storage choices, as users.file_storage stores them.
const (
	StorageServer = "server"
	StorageDrive  = "drive"
)

// StorageSetting reads a learner's choice.
type StorageSetting func(ctx context.Context, userID uuid.UUID) (string, error)

// StorageChoice is the router's BackendFor over the learner's setting. With
// no Drive backend (Drive is not configured) every learner is on local, and
// the setting is not read.
func StorageChoice(local *Local, drive *Drive, setting StorageSetting) BackendFor {
	if drive == nil {
		return func(context.Context, uuid.UUID) (Backend, error) { return local, nil }
	}
	onServer := drive.OnServer()
	return func(ctx context.Context, userID uuid.UUID) (Backend, error) {
		choice, err := setting(ctx, userID)
		if err != nil {
			return nil, err
		}
		if choice == StorageDrive {
			return drive, nil
		}
		return onServer, nil
	}
}

// OnServer is the backend of a learner who keeps their files on the server
// while some may still be in their Drive: writes go to the server's disk,
// reads and deletes follow drive_files through the Drive backend.
func (d *Drive) OnServer() Backend { return serverSide{d: d} }

type serverSide struct{ d *Drive }

var _ Backend = serverSide{}

// PutOriginal stores the bytes on the server, unless the same bytes are
// already in this learner's Drive: an original is addressed by its digest,
// so that copy is the same file, and the move back will bring it.
func (s serverSide) PutOriginal(ctx context.Context, userID uuid.UUID, data []byte) (string, error) {
	digest := Digest(data)
	unlock := s.d.keys.lock(userID, KindOriginal, digest)
	defer unlock()
	row, err := s.d.index.GetDriveFile(ctx, userID, KindOriginal, digest)
	switch {
	case err == nil && row.MissingAt == nil:
		return digest, nil
	case err != nil && !errors.Is(err, ErrNotFound):
		return "", err
	}
	removed := err == nil // a row, marked missing
	if _, err := s.d.local.PutOriginal(ctx, userID, data); err != nil {
		return "", err
	}
	if removed {
		// The row named a copy the learner removed from Drive; the
		// server's new copy is the file now.
		if err := s.d.index.DeleteDriveFile(ctx, userID, KindOriginal, digest); err != nil {
			return "", err
		}
	}
	return digest, nil
}

func (s serverSide) GetOriginal(ctx context.Context, userID uuid.UUID, digest string) ([]byte, error) {
	return s.d.GetOriginal(ctx, userID, digest)
}

func (s serverSide) OpenOriginal(ctx context.Context, userID uuid.UUID, digest string) (*File, error) {
	return s.d.OpenOriginal(ctx, userID, digest)
}

func (s serverSide) DeleteOriginal(ctx context.Context, userID uuid.UUID, digest string) error {
	return s.d.DeleteOriginal(ctx, userID, digest)
}

func (s serverSide) PutParsed(ctx context.Context, userID, docID uuid.UUID, version int, markdown string) (string, error) {
	return s.d.local.PutParsed(ctx, userID, docID, version, markdown)
}

func (s serverSide) GetParsed(ctx context.Context, path string) (string, error) {
	return s.d.local.GetParsed(ctx, path)
}

func (s serverSide) DeleteDocument(ctx context.Context, userID, docID uuid.UUID) error {
	return s.d.local.DeleteDocument(ctx, userID, docID)
}

func (s serverSide) DeleteUser(ctx context.Context, userID uuid.UUID) error {
	return s.d.DeleteUser(ctx, userID)
}

// PutObject and WriteObject write the server's copy, then forget any older
// copy in Drive: the object was written again, and the new bytes are on the
// server.
func (s serverSide) PutObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID, data []byte) error {
	unlock := s.d.keys.lock(userID, namespace, id.String())
	defer unlock()
	if err := s.d.local.PutObject(ctx, userID, namespace, id, data); err != nil {
		return err
	}
	return s.forgetDriveCopy(ctx, userID, namespace, id)
}

func (s serverSide) WriteObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID, write func(io.Writer) error) error {
	unlock := s.d.keys.lock(userID, namespace, id.String())
	defer unlock()
	if err := s.d.local.WriteObject(ctx, userID, namespace, id, write); err != nil {
		return err
	}
	return s.forgetDriveCopy(ctx, userID, namespace, id)
}

func (s serverSide) GetObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) ([]byte, error) {
	return s.d.GetObject(ctx, userID, namespace, id)
}

func (s serverSide) OpenObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) (*File, error) {
	return s.d.OpenObject(ctx, userID, namespace, id)
}

func (s serverSide) DeleteObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) error {
	return s.d.DeleteObject(ctx, userID, namespace, id)
}

// forgetDriveCopy drops the row first, so reads find the server's new copy
// at once, then deletes the replaced file from Drive. A Drive that cannot be
// reached keeps the replaced file; it is unreferenced and harmless.
func (s serverSide) forgetDriveCopy(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) error {
	if _, ok := driveFolders[namespace]; !ok {
		return nil
	}
	row, err := s.d.index.GetDriveFile(ctx, userID, namespace, id.String())
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := s.d.index.DeleteDriveFile(ctx, userID, namespace, id.String()); err != nil {
		return err
	}
	if err := s.d.remote.Delete(ctx, userID, row.DriveFileID); err != nil {
		slog.Warn("blob: a replaced file could not be removed from Drive", "error", err, "user", userID)
	}
	s.d.cache.Remove(userID, row.SHA256)
	return nil
}
