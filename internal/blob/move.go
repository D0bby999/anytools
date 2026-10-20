package blob

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/google/uuid"
)

// move.go — moving a learner's existing files between the server and their
// Drive, one file at a time, in either direction (drive-user-storage
// phase 2, plan decision 6).
//
// A move is planned once, when it is asked for (PlanMove), and then run one
// file per unit through the job queue (MoveOne), so a retry resumes at the
// first file not yet moved. Each unit, in this order:
//
//  1. reads the file from where it is;
//  2. writes it to where it goes;
//  3. checks the new copy's checksum: Drive's own sha256Checksum of what it
//     holds, or the sha256 of what reached the server's disk;
//  4. records the new location (a drive_files row, or no row);
//  5. and only then deletes the old copy.
//
// Every step can be interrupted, and a rerun of the same unit finishes the
// job without a second copy and without losing one:
//
//   - uploaded but not recorded: the upload is found again by its
//     appProperties (RemoteLookup.Find) and adopted, not uploaded twice;
//   - recorded in Drive but the server copy not deleted: the row is there,
//     so the rerun deletes the server copy;
//   - written to the server but not recorded: the rerun copies it again over
//     the same path, which is the same bytes;
//   - recorded on the server but the Drive copy not deleted: the Drive copy
//     is found by its appProperties and deleted once its sha256 matches the
//     server's.
//
// A file whose copy does not check out is left where it was, and the move
// carries on with the next one: the bad copy is removed, the old one stays,
// and Settings → Storage still counts it where it is.

// MoveDirection is which way a move carries files.
type MoveDirection string

const (
	// MoveToDrive moves files from the server's disk to the learner's Drive.
	MoveToDrive MoveDirection = "to_drive"
	// MoveToServer moves files from the learner's Drive back to the server.
	MoveToServer MoveDirection = "to_server"
)

// Valid reports whether d names a direction.
func (d MoveDirection) Valid() bool { return d == MoveToDrive || d == MoveToServer }

// MoveItem is one file a move plans to carry.
type MoveItem struct {
	Kind  string `json:"kind"`
	Key   string `json:"key"`
	Bytes int64  `json:"bytes"`
}

// RemoteCopy is a file in the learner's Drive as Drive describes it.
type RemoteCopy struct {
	ID   string
	Size int64
	// MD5 and SHA256 are Drive's own checksums of the bytes it stores.
	// Drive may leave SHA256 empty; MD5 is then what is checked.
	MD5, SHA256 string
	// PropSHA256 is the sha256 appProperty AnyTools gave the file when it
	// wrote it.
	PropSHA256 string
	Trashed    bool
}

// RemoteLookup is what a move needs from the learner's Drive beyond Remote.
type RemoteLookup interface {
	// Find lists the files AnyTools wrote for (kind, key), by their
	// appProperties, oldest first; trashed ones are left out.
	Find(ctx context.Context, userID uuid.UUID, kind, key string) ([]RemoteCopy, error)
	// Stat describes one file. A file gone from Drive is ErrRemoved.
	Stat(ctx context.Context, userID uuid.UUID, fileID string) (RemoteCopy, error)
}

// FolderMaker creates the learner's "AnyTools" folder and its subfolders, or
// finds them again.
type FolderMaker interface {
	EnsureFolders(ctx context.Context, userID uuid.UUID) (map[string]string, error)
}

// MoveIndex is what a move needs from drive_files beyond DriveIndex. Both
// conditional writes are how a move steps aside when the learner changed the
// same file while it ran.
type MoveIndex interface {
	// ListDriveFiles lists the learner's rows, oldest first.
	ListDriveFiles(ctx context.Context, userID uuid.UUID) ([]DriveFile, error)
	// InsertDriveFile records a file only if it has no row yet, and reports
	// whether it did.
	InsertDriveFile(ctx context.Context, f DriveFile) (bool, error)
	// DeleteDriveFileIf removes a row only while it still names fileID.
	DeleteDriveFileIf(ctx context.Context, userID uuid.UUID, kind, key, fileID string) (bool, error)
}

// ErrMoveUnsupported is a Drive backend whose remote or index cannot move
// files (a test double that implements only the phase 1 interfaces).
var ErrMoveUnsupported = errors.New("blob: this Drive backend cannot move files")

func (d *Drive) lookup() (RemoteLookup, MoveIndex, error) {
	rl, ok1 := d.remote.(RemoteLookup)
	mi, ok2 := d.index.(MoveIndex)
	if !ok1 || !ok2 {
		return nil, nil, ErrMoveUnsupported
	}
	return rl, mi, nil
}

// EnsureFolders creates the learner's folders in their Drive, or finds them
// again. Turning Drive storage on calls it first, so a broken connection is
// found then rather than at the first upload.
func (d *Drive) EnsureFolders(ctx context.Context, userID uuid.UUID) error {
	fm, ok := d.remote.(FolderMaker)
	if !ok {
		return ErrMoveUnsupported
	}
	_, err := fm.EnsureFolders(ctx, userID)
	return err
}

// ─────────────────────────────────────────────────────────────────── plan

// PlanMove lists the files a move in direction dir would carry: the
// learner's own files on the server's disk, or their rows in Drive. A file
// already marked removed from Drive cannot be read, so it is not planned.
func (d *Drive) PlanMove(ctx context.Context, userID uuid.UUID, dir MoveDirection) ([]MoveItem, error) {
	switch dir {
	case MoveToDrive:
		return d.local.ListFiles(ctx, userID)
	case MoveToServer:
		_, mi, err := d.lookup()
		if err != nil {
			return nil, err
		}
		rows, err := mi.ListDriveFiles(ctx, userID)
		if err != nil {
			return nil, err
		}
		out := make([]MoveItem, 0, len(rows))
		for _, r := range rows {
			if r.MissingAt == nil {
				out = append(out, MoveItem{Kind: r.Kind, Key: r.Key, Bytes: r.Bytes})
			}
		}
		return out, nil
	}
	return nil, fmt.Errorf("blob: unknown move direction %q", dir)
}

// ListFiles lists the learner's own files on the server, in its bucket or on
// its disk: their originals and the objects of every kind Drive keeps.
// Derived files (parsed text, transcript windows, audio parts) are not
// theirs to move. A file in both places is listed once, at the bucket's size.
func (l *Local) ListFiles(ctx context.Context, userID uuid.UUID) ([]MoveItem, error) {
	if userID == uuid.Nil {
		return nil, errors.New("blob: nil id")
	}
	var out []MoveItem
	seen := map[[2]string]bool{}
	add := func(it MoveItem) {
		if k := [2]string{it.Kind, it.Key}; !seen[k] {
			seen[k] = true
			out = append(out, it)
		}
	}
	originals := filepath.Join(l.root, "originals", userID.String())
	original := func(path string, size int64) {
		name := filepath.Base(path)
		if validDigest(name) == nil && filepath.Base(filepath.Dir(path)) == name[:2] {
			add(MoveItem{Kind: KindOriginal, Key: name, Bytes: size})
		}
	}
	if err := l.listBucket(ctx, "originals/"+userID.String()+"/", original); err != nil {
		return nil, err
	}
	if err := walkFiles(originals, original); err != nil {
		return nil, err
	}
	for ns := range driveFolders {
		if ns == KindOriginal {
			continue
		}
		dir := filepath.Join(l.root, "objects", userID.String(), ns)
		object := func(path string, size int64) {
			if id, err := uuid.Parse(filepath.Base(path)); err == nil && filepath.Dir(path) == dir && id != uuid.Nil {
				add(MoveItem{Kind: ns, Key: id.String(), Bytes: size})
			}
		}
		if err := l.listBucket(ctx, "objects/"+userID.String()+"/"+ns+"/", object); err != nil {
			return nil, err
		}
		if err := walkFiles(dir, object); err != nil {
			return nil, err
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return out[i].Kind < out[j].Kind
		}
		return out[i].Key < out[j].Key
	})
	return out, nil
}

// walkFiles calls fn for every regular file under root, skipping temporary
// files. A missing root is no files.
func walkFiles(root string, fn func(path string, size int64)) error {
	err := filepath.WalkDir(root, func(path string, e fs.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil
			}
			return err
		}
		if !e.Type().IsRegular() || strings.HasPrefix(e.Name(), ".tmp-") {
			return nil
		}
		info, err := e.Info()
		if err != nil {
			return nil
		}
		fn(path, info.Size())
		return nil
	})
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}

// localPath is where a file of this kind and key lives on the server.
func (l *Local) localPath(userID uuid.UUID, kind, key string) (string, error) {
	if kind == KindOriginal {
		return l.originalPath(userID, key)
	}
	id, err := uuid.Parse(key)
	if err != nil {
		return "", fmt.Errorf("blob: malformed key")
	}
	return l.objectPath(userID, kind, id)
}

// ──────────────────────────────────────────────────────────────────── run

// MoveOne carries one planned file in direction dir and reports whether it
// is now where the move takes it. A file that changed or went away since the
// plan, or whose copy did not check out, is left where it is (false, nil). An
// error is worth retrying: the next attempt resumes this unit.
func (d *Drive) MoveOne(ctx context.Context, userID uuid.UUID, dir MoveDirection, it MoveItem) (bool, error) {
	if _, ok := driveFolders[it.Kind]; !ok {
		return false, nil
	}
	path, err := d.local.localPath(userID, it.Kind, it.Key)
	if err != nil {
		return false, err
	}
	rl, mi, err := d.lookup()
	if err != nil {
		return false, err
	}
	unlock := d.keys.lock(userID, it.Kind, it.Key)
	defer unlock()
	switch dir {
	case MoveToDrive:
		return d.moveToDrive(ctx, userID, it, path, rl, mi)
	case MoveToServer:
		return d.moveToServer(ctx, userID, it, path, rl, mi)
	}
	return false, fmt.Errorf("blob: unknown move direction %q", dir)
}

func (d *Drive) moveToDrive(ctx context.Context, userID uuid.UUID, it MoveItem, path string, rl RemoteLookup, mi MoveIndex) (bool, error) {
	row, err := d.index.GetDriveFile(ctx, userID, it.Kind, it.Key)
	switch {
	case err == nil && row.MissingAt == nil:
		// Already recorded in Drive: an earlier attempt got as far as the
		// row, or the learner wrote the file again since. Either way the
		// server's copy is the old one.
		return true, d.local.removeAt(ctx, path)
	case err != nil && !errors.Is(err, ErrNotFound):
		return false, err
	}

	f, done, err := d.local.moveSource(ctx, path)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil // deleted since the plan
	}
	if err != nil {
		return false, err
	}
	defer done()
	sum, err := sumFile(f)
	if err != nil {
		return false, err
	}
	if it.Kind == KindOriginal && sum.sha != it.Key {
		slog.Warn("blob: a server copy does not match its digest and was not moved", "user", userID, "kind", it.Kind)
		return false, nil
	}

	// 1–2. Find the upload an interrupted attempt made, or upload now.
	fileID, mimeType := "", ""
	found, err := rl.Find(ctx, userID, it.Kind, it.Key)
	if err != nil {
		return false, err
	}
	for _, c := range found {
		if c.Size == sum.size && c.PropSHA256 == sum.sha {
			fileID = c.ID
			break
		}
	}
	if fileID == "" {
		rf, mt, err := d.upload(ctx, userID, it.Kind, it.Key, f, sum.size, sum.sha)
		if err != nil {
			return false, err
		}
		fileID, mimeType = rf.ID, mt
	} else {
		head := make([]byte, min(512, sum.size))
		n, _ := f.ReadAt(head, 0)
		_, mimeType = d.title(ctx, userID, it.Kind, it.Key)
		if mimeType == "" {
			mimeType = sniffMIME(head[:n])
		}
	}

	// 3. Drive's own checksum of what it holds, before anything else.
	if err := checkRemote(ctx, rl, userID, fileID, sum); err != nil {
		if errors.Is(err, ErrCorrupt) {
			if derr := d.remote.Delete(ctx, userID, fileID); derr != nil {
				slog.Warn("blob: a copy that did not match could not be removed from Drive", "error", derr, "user", userID)
			}
			slog.Warn("blob: a file's copy in Drive did not match and the server copy was kept", "user", userID, "kind", it.Kind)
			return false, nil
		}
		return false, err
	}

	// 4. Record it, unless the learner wrote this file again meanwhile.
	inserted, err := mi.InsertDriveFile(ctx, DriveFile{
		UserID: userID, Kind: it.Kind, Key: it.Key,
		DriveFileID: fileID, SHA256: sum.sha, Bytes: sum.size, MIME: mimeType,
	})
	if err != nil {
		return false, err
	}
	if !inserted {
		cur, err := d.index.GetDriveFile(ctx, userID, it.Kind, it.Key)
		if err != nil {
			return false, err
		}
		switch {
		case cur.MissingAt != nil:
			// The row names a file the learner removed from Drive: ours
			// replaces it.
			if err := d.index.PutDriveFile(ctx, DriveFile{
				UserID: userID, Kind: it.Kind, Key: it.Key,
				DriveFileID: fileID, SHA256: sum.sha, Bytes: sum.size, MIME: mimeType,
			}); err != nil {
				return false, err
			}
		case cur.DriveFileID != fileID:
			// A newer copy is in Drive, so ours is a stale duplicate.
			if derr := d.remote.Delete(ctx, userID, fileID); derr != nil {
				slog.Warn("blob: a stale copy could not be removed from Drive", "error", derr, "user", userID)
			}
		}
	}

	// 5. Only now the old copy.
	return true, d.local.removeAt(ctx, path)
}

func (d *Drive) moveToServer(ctx context.Context, userID uuid.UUID, it MoveItem, path string, rl RemoteLookup, mi MoveIndex) (bool, error) {
	row, err := d.index.GetDriveFile(ctx, userID, it.Kind, it.Key)
	if errors.Is(err, ErrNotFound) {
		// No row: an earlier attempt recorded the file on the server and
		// stopped before deleting the Drive copy, or the file was deleted.
		return d.dropMovedCopies(ctx, userID, it, path, rl)
	}
	if err != nil {
		return false, err
	}
	if row.MissingAt != nil {
		return false, nil
	}

	// 1. Read it: the cached copy if there is one, else Drive.
	var src io.ReadCloser
	if f, ok := d.cache.Open(userID, row.SHA256, row.Bytes); ok {
		src = f
	} else {
		rc, err := d.remoteOpen(ctx, row)
		if errors.Is(err, ErrRemoved) || errors.Is(err, ErrCorrupt) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		src = rc
	}
	defer src.Close()

	// 2–3. Write it beside its place, checking as it goes. It is renamed
	// into place only once its size and sha256 are the recorded ones.
	if err := d.local.writeCheckedAt(ctx, path, src, row.Bytes, row.SHA256); err != nil {
		if errors.Is(err, ErrCorrupt) {
			slog.Warn("blob: a file read from Drive did not match its record and was left there", "user", userID, "kind", it.Kind)
			return false, nil
		}
		return false, err
	}

	// 4. No row means the server, unless the learner changed the file
	// meanwhile; then the copy just written is not theirs to keep.
	removed, err := mi.DeleteDriveFileIf(ctx, userID, it.Kind, it.Key, row.DriveFileID)
	if err != nil {
		return false, err
	}
	if !removed {
		return false, d.local.removeAt(ctx, path)
	}

	// 5. Only now the old copy. If this fails, the rerun finds it by its
	// appProperties.
	if err := d.remote.Delete(ctx, userID, row.DriveFileID); err != nil {
		return true, err
	}
	return true, nil
}

// dropMovedCopies finishes a move to the server whose row is already gone:
// any copy still in Drive whose sha256 matches the server's copy is deleted.
func (d *Drive) dropMovedCopies(ctx context.Context, userID uuid.UUID, it MoveItem, path string, rl RemoteLookup) (bool, error) {
	f, done, err := d.local.moveSource(ctx, path)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	sum, err := sumFile(f)
	done()
	if err != nil {
		return false, err
	}
	found, err := rl.Find(ctx, userID, it.Kind, it.Key)
	if err != nil {
		return false, err
	}
	for _, c := range found {
		if c.PropSHA256 == sum.sha && c.Size == sum.size {
			if err := d.remote.Delete(ctx, userID, c.ID); err != nil {
				return true, err
			}
		}
	}
	return true, nil
}

// checkRemote compares Drive's own description of a file with the bytes
// sent: its size, and its sha256Checksum, or its md5Checksum when Drive gives
// no sha256.
func checkRemote(ctx context.Context, rl RemoteLookup, userID uuid.UUID, fileID string, sum fileSum) error {
	st, err := rl.Stat(ctx, userID, fileID)
	if err != nil {
		return err
	}
	switch {
	case st.Trashed:
		return ErrRemoved
	case st.Size != sum.size:
		return ErrCorrupt
	case st.SHA256 != "":
		if !strings.EqualFold(st.SHA256, sum.sha) {
			return ErrCorrupt
		}
	case st.MD5 == "" || !strings.EqualFold(st.MD5, sum.md5):
		return ErrCorrupt
	}
	return nil
}

type fileSum struct {
	size     int64
	sha, md5 string
}

func sumFile(f *os.File) (fileSum, error) {
	sh, m := sha256.New(), md5.New()
	n, err := io.Copy(io.MultiWriter(sh, m), io.NewSectionReader(f, 0, 1<<62))
	if err != nil {
		return fileSum{}, err
	}
	return fileSum{size: n, sha: hex.EncodeToString(sh.Sum(nil)), md5: hex.EncodeToString(m.Sum(nil))}, nil
}

// writeChecked streams r to path through a temporary file and renames it
// into place only if exactly size bytes with this sha256 arrived. Anything
// else leaves nothing behind and is ErrCorrupt.
func writeChecked(path string, r io.Reader, size int64, want string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("blob: create dir: %w", err)
	}
	f, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return fmt.Errorf("blob: temp file: %w", err)
	}
	tmp := f.Name()
	defer os.Remove(tmp) // no-op once the rename has succeeded
	sh := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, sh), io.LimitReader(r, size+1))
	if err != nil {
		f.Close()
		if errors.Is(err, ErrCorrupt) {
			return ErrCorrupt
		}
		return err
	}
	if n != size || hex.EncodeToString(sh.Sum(nil)) != want {
		f.Close()
		return ErrCorrupt
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return fmt.Errorf("blob: sync: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("blob: close: %w", err)
	}
	if err := os.Chmod(tmp, 0o600); err != nil {
		return fmt.Errorf("blob: chmod: %w", err)
	}
	return os.Rename(tmp, path)
}

func removeFile(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// ─────────────────────────────────────────────────────────────── exports

// SaveExport writes an export (a worksheet, study notes, a book, a notebook)
// into the learner's "Exports" folder and returns its Drive file id. Exports
// are the learner's copies, not files AnyTools reads back, so no row records
// them; key goes in their appProperties.
func (d *Drive) SaveExport(ctx context.Context, userID uuid.UUID, key, name, mimeType string, data []byte) (string, error) {
	rf, err := d.remote.Put(ctx, userID, RemoteUpload{
		Folder: FolderExports,
		Name:   name,
		MIME:   mimeType,
		Kind:   "export", Key: key, SHA256: Digest(data),
		Size: int64(len(data)),
		Body: bytes.NewReader(data),
	})
	if err != nil {
		return "", err
	}
	return rf.ID, nil
}

// ───────────────────────────────────────────────────────────────── locks

// keyLocks serialises everything that writes, deletes or moves one file of
// one learner, so a move never records a copy older than the learner's own
// write that landed while it ran. Striped: a fixed set of mutexes, so the
// map never grows. It is process-local, like the rest of the Drive
// backend's coordination.
type keyLocks struct {
	stripes [64]sync.Mutex
}

func (k *keyLocks) lock(userID uuid.UUID, kind, key string) func() {
	h := fnv.New32a()
	_, _ = h.Write(userID[:])
	_, _ = h.Write([]byte(kind))
	_, _ = h.Write([]byte{0})
	_, _ = h.Write([]byte(key))
	m := &k.stripes[h.Sum32()%uint32(len(k.stripes))]
	m.Lock()
	return m.Unlock
}
