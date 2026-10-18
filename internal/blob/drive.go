package blob

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
)

// drive.go — the Drive backend: a learner's own files kept in their Google
// Drive, under a "AnyTools" folder AnyTools creates (drive-user-storage
// phase 1).
//
// This package knows nothing about Google. It is written against two small
// interfaces: Remote, which internal/connectors/drive implements over the
// Drive v3 REST API, and DriveIndex, which internal/store/pg implements over
// the drive_files table. internal/app wires the three together.
//
// What moves and what stays (plan decision 2): originals, recordings,
// generated audio, exam papers and page photos go to Drive. Everything
// derived stays on the server's disk: parsed Markdown, an exam's parsed text,
// transcript windows and the audio parts an overview is joined from. Drive
// passes those namespaces straight to the server's Local.
//
// Where a file is is recorded, not assumed: a file with a drive_files row is
// in Drive, a file without one is on the server. Reads and deletes follow the
// row, so a learner part way through a move (phase 2) reads both. Writes of a
// kept kind always go to Drive, and a write Drive refuses fails; nothing falls
// back to the server's disk (plan decision 5).

// KindOriginal is the drive_files kind of an uploaded original. Objects use
// their namespace as their kind.
const KindOriginal = "original"

// Folder roles: the "AnyTools" folder and its subfolders.
const (
	FolderRoot       = "root"
	FolderUploads    = "uploads"
	FolderRecordings = "recordings"
	FolderAudio      = "audio"
	FolderExamPapers = "exam_papers"
	FolderExports    = "exports"
)

// FolderRoles lists every folder, the root first.
var FolderRoles = []string{FolderRoot, FolderUploads, FolderRecordings, FolderAudio, FolderExamPapers, FolderExports}

// driveFolders names the kinds Drive keeps and the folder each goes in. The
// namespaces are the callers' constants (audio.nsAudio, exam.nsPaper,
// worksheet.RecordingNamespace, knowledge.photoPages); any other namespace is
// derived and stays on the server.
var driveFolders = map[string]string{
	KindOriginal:  FolderUploads,
	"recordings":  FolderRecordings,
	"audio":       FolderAudio,
	"exam_papers": FolderExamPapers,
	"photopages":  FolderUploads,
}

// DriveFolderFor reports whether Drive keeps files of this kind, and where.
func DriveFolderFor(kind string) (string, bool) {
	f, ok := driveFolders[kind]
	return f, ok
}

// ErrCorrupt is a stored file whose bytes do not match the checksum recorded
// when it was written. It is never served as if it were the file.
var ErrCorrupt = errors.New("blob: the stored file does not match its checksum")

// ErrRemoved is a file the learner deleted or trashed in their Drive. It is a
// kind of ErrNotFound, so callers that only know "missing" still answer 404.
var ErrRemoved = fmt.Errorf("blob: the file was removed from the learner's Drive: %w", ErrNotFound)

// RemoteUpload is one file on its way into the learner's Drive.
type RemoteUpload struct {
	// Folder is the role of the folder it goes in.
	Folder string
	// Name is what the learner sees in Drive: readable, never an id alone.
	Name string
	MIME string
	// Kind, Key and SHA256 become the file's appProperties, so a reconnect
	// can find it again without the database.
	Kind, Key, SHA256 string
	Size              int64
	// Body is read at any offset, by more than one request at a time: an
	// abandoned request may still be reading its chunk while the next one
	// starts.
	Body io.ReaderAt
}

// RemoteFile is a file Remote wrote, its size and checksum already checked.
type RemoteFile struct {
	ID string
}

// Remote is the learner's Drive.
type Remote interface {
	// Put uploads a file and returns it only once Drive has confirmed the
	// size and checksum it received.
	Put(ctx context.Context, userID uuid.UUID, up RemoteUpload) (RemoteFile, error)
	// Open returns a lazy reader that fetches ranges as it is read and
	// sought. A file gone from Drive is ErrRemoved; one whose size is not
	// size is ErrCorrupt.
	Open(ctx context.Context, userID uuid.UUID, fileID string, size int64) (io.ReadSeekCloser, error)
	// Delete removes a file. One already gone is not an error.
	Delete(ctx context.Context, userID uuid.UUID, fileID string) error
}

// DriveFile is one drive_files row: where one of a learner's files is.
type DriveFile struct {
	UserID      uuid.UUID
	Kind        string
	Key         string
	DriveFileID string
	SHA256      string
	Bytes       int64
	MIME        string
	CreatedAt   time.Time
	MissingAt   *time.Time
}

// DriveIndex is the drive_files table. Every method is scoped by the user.
type DriveIndex interface {
	// GetDriveFile returns ErrNotFound when the file is not in Drive.
	GetDriveFile(ctx context.Context, userID uuid.UUID, kind, key string) (*DriveFile, error)
	// PutDriveFile records or replaces a file's location and clears
	// missing_at.
	PutDriveFile(ctx context.Context, f DriveFile) error
	DeleteDriveFile(ctx context.Context, userID uuid.UUID, kind, key string) error
	MarkDriveFileMissing(ctx context.Context, userID uuid.UUID, kind, key string) error
}

// Namer returns the title of the thing a file belongs to (a document, a
// worksheet, an audio overview) and, when the row knows it, its MIME type.
// Empty answers fall back to a label and the date.
type Namer func(ctx context.Context, userID uuid.UUID, kind, key string) (title, mime string)

// Drive keeps a learner's own files in their Google Drive.
type Drive struct {
	local  *Local
	remote Remote
	index  DriveIndex
	cache  *Cache
	title  Namer
	now    func() time.Time
	// keys serialises the writes and moves of one file (move.go).
	keys keyLocks
}

// DriveConfig assembles a Drive.
type DriveConfig struct {
	// Local holds what stays on the server, and the files written before
	// the learner chose Drive.
	Local  *Local
	Remote Remote
	Index  DriveIndex
	Cache  *Cache
	// Title is optional.
	Title Namer
	Now   func() time.Time
}

var _ Backend = (*Drive)(nil)

// NewDrive returns a Drive backend.
func NewDrive(cfg DriveConfig) (*Drive, error) {
	if cfg.Local == nil || cfg.Remote == nil || cfg.Index == nil || cfg.Cache == nil {
		return nil, errors.New("blob: the Drive backend needs a local store, a remote, an index and a cache")
	}
	d := &Drive{local: cfg.Local, remote: cfg.Remote, index: cfg.Index, cache: cfg.Cache, title: cfg.Title, now: cfg.Now}
	if d.title == nil {
		d.title = func(context.Context, uuid.UUID, string, string) (string, string) { return "", "" }
	}
	if d.now == nil {
		d.now = time.Now
	}
	return d, nil
}

// ─────────────────────────────────────────────────────────────── originals

// PutOriginal uploads an original once: the same bytes already in this
// learner's Drive are reused, not uploaded again.
func (d *Drive) PutOriginal(ctx context.Context, userID uuid.UUID, data []byte) (string, error) {
	digest := Digest(data)
	row, err := d.index.GetDriveFile(ctx, userID, KindOriginal, digest)
	switch {
	case err == nil && row.MissingAt == nil:
		return digest, nil
	case err != nil && !errors.Is(err, ErrNotFound):
		return "", err
	}
	if err := d.write(ctx, userID, KindOriginal, digest, bytes.NewReader(data), int64(len(data)), digest); err != nil {
		return "", err
	}
	d.cachePut(userID, data)
	// A copy written to the server before the learner chose Drive is now a
	// duplicate nobody reads.
	if err := d.local.DeleteOriginal(ctx, userID, digest); err != nil {
		slog.Warn("blob: could not remove the server's copy of an original now in Drive", "error", err, "user", userID)
	}
	return digest, nil
}

func (d *Drive) GetOriginal(ctx context.Context, userID uuid.UUID, digest string) ([]byte, error) {
	if err := validDigest(digest); err != nil {
		return nil, err
	}
	row, err := d.index.GetDriveFile(ctx, userID, KindOriginal, digest)
	if errors.Is(err, ErrNotFound) {
		return d.local.GetOriginal(ctx, userID, digest)
	}
	if err != nil {
		return nil, err
	}
	return d.readAll(ctx, row)
}

func (d *Drive) OpenOriginal(ctx context.Context, userID uuid.UUID, digest string) (*File, error) {
	if err := validDigest(digest); err != nil {
		return nil, err
	}
	row, err := d.index.GetDriveFile(ctx, userID, KindOriginal, digest)
	if errors.Is(err, ErrNotFound) {
		return d.local.OpenOriginal(ctx, userID, digest)
	}
	if err != nil {
		return nil, err
	}
	return d.open(ctx, row)
}

func (d *Drive) DeleteOriginal(ctx context.Context, userID uuid.UUID, digest string) error {
	if err := validDigest(digest); err != nil {
		return err
	}
	unlock := d.keys.lock(userID, KindOriginal, digest)
	defer unlock()
	if err := d.delete(ctx, userID, KindOriginal, digest); err != nil {
		return err
	}
	return d.local.DeleteOriginal(ctx, userID, digest)
}

// PutParsed, GetParsed and DeleteDocument stay on the server's disk: parsed
// text is what search reads (owner decision 3).
func (d *Drive) PutParsed(ctx context.Context, userID, docID uuid.UUID, version int, markdown string) (string, error) {
	return d.local.PutParsed(ctx, userID, docID, version, markdown)
}

func (d *Drive) GetParsed(ctx context.Context, path string) (string, error) {
	return d.local.GetParsed(ctx, path)
}

func (d *Drive) DeleteDocument(ctx context.Context, userID, docID uuid.UUID) error {
	return d.local.DeleteDocument(ctx, userID, docID)
}

// DeleteUser removes the learner's cache on the server, and nothing in their
// Drive: the "AnyTools" folder is theirs to keep (owner decision 1). The
// drive_files rows go with the user row, by cascade.
func (d *Drive) DeleteUser(_ context.Context, userID uuid.UUID) error {
	return d.cache.DeleteUser(userID)
}

// ───────────────────────────────────────────────────────────────── objects

func (d *Drive) PutObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID, data []byte) error {
	if err := checkObject(userID, namespace, id); err != nil {
		return err
	}
	if _, ok := driveFolders[namespace]; !ok {
		return d.local.PutObject(ctx, userID, namespace, id, data)
	}
	if err := d.write(ctx, userID, namespace, id.String(), bytes.NewReader(data), int64(len(data)), Digest(data)); err != nil {
		return err
	}
	d.cachePut(userID, data)
	d.dropServerObject(ctx, userID, namespace, id)
	return nil
}

// WriteObject stages the stream in the cache, uploads it from there, and
// keeps it cached: an audio overview is usually played right after it is
// made.
func (d *Drive) WriteObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID, write func(io.Writer) error) error {
	if err := checkObject(userID, namespace, id); err != nil {
		return err
	}
	if _, ok := driveFolders[namespace]; !ok {
		return d.local.WriteObject(ctx, userID, namespace, id, write)
	}
	stage, err := d.cache.Stage(userID)
	if err != nil {
		return err
	}
	if err := write(stage); err != nil {
		stage.Discard()
		return err
	}
	if err := d.write(ctx, userID, namespace, id.String(), stage.ReaderAt(), stage.Len(), stage.Digest()); err != nil {
		stage.Discard()
		return err
	}
	if err := stage.Commit(); err != nil {
		slog.Warn("blob: could not cache a file written to Drive", "error", err, "user", userID)
	}
	d.dropServerObject(ctx, userID, namespace, id)
	return nil
}

func (d *Drive) GetObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) ([]byte, error) {
	row, err := d.objectRow(ctx, userID, namespace, id)
	if errors.Is(err, ErrNotFound) {
		return d.local.GetObject(ctx, userID, namespace, id)
	}
	if err != nil {
		return nil, err
	}
	return d.readAll(ctx, row)
}

func (d *Drive) OpenObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) (*File, error) {
	row, err := d.objectRow(ctx, userID, namespace, id)
	if errors.Is(err, ErrNotFound) {
		return d.local.OpenObject(ctx, userID, namespace, id)
	}
	if err != nil {
		return nil, err
	}
	return d.open(ctx, row)
}

func (d *Drive) DeleteObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) error {
	if err := checkObject(userID, namespace, id); err != nil {
		return err
	}
	unlock := d.keys.lock(userID, namespace, id.String())
	defer unlock()
	if _, ok := driveFolders[namespace]; ok {
		if err := d.delete(ctx, userID, namespace, id.String()); err != nil {
			return err
		}
	}
	return d.local.DeleteObject(ctx, userID, namespace, id)
}

// objectRow finds an object's row. A namespace Drive does not keep has none.
func (d *Drive) objectRow(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) (*DriveFile, error) {
	if err := checkObject(userID, namespace, id); err != nil {
		return nil, err
	}
	if _, ok := driveFolders[namespace]; !ok {
		return nil, ErrNotFound
	}
	return d.index.GetDriveFile(ctx, userID, namespace, id.String())
}

func (d *Drive) dropServerObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) {
	if err := d.local.DeleteObject(ctx, userID, namespace, id); err != nil {
		slog.Warn("blob: could not remove the server's copy of a file now in Drive", "error", err, "user", userID)
	}
}

// checkObject applies Local's rules for an object's name, so a bad namespace
// is refused the same way whichever backend holds the learner's files.
func checkObject(userID uuid.UUID, namespace string, id uuid.UUID) error {
	_, err := (&Local{}).objectPath(userID, namespace, id)
	return err
}

// ──────────────────────────────────────────────────────────────── the core

// write uploads one file and records where it went, in that order: a row
// never names a file Drive did not confirm. If the row cannot be written,
// the uploaded file is deleted again. A file that replaces another (an
// object written twice) deletes the old one only after the new row is in.
func (d *Drive) write(ctx context.Context, userID uuid.UUID, kind, key string, body io.ReaderAt, size int64, sha string) error {
	unlock := d.keys.lock(userID, kind, key)
	defer unlock()
	old, err := d.index.GetDriveFile(ctx, userID, kind, key)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return err
	}

	rf, mimeType, err := d.upload(ctx, userID, kind, key, body, size, sha)
	if err != nil {
		return err
	}
	if err := d.index.PutDriveFile(ctx, DriveFile{
		UserID: userID, Kind: kind, Key: key,
		DriveFileID: rf.ID, SHA256: sha, Bytes: size, MIME: mimeType,
	}); err != nil {
		if derr := d.remote.Delete(ctx, userID, rf.ID); derr != nil {
			slog.Warn("blob: a file uploaded to Drive could not be recorded or removed again", "error", derr, "user", userID)
		}
		return err
	}
	if old != nil && old.DriveFileID != rf.ID {
		if err := d.remote.Delete(ctx, userID, old.DriveFileID); err != nil {
			slog.Warn("blob: the replaced file could not be removed from Drive", "error", err, "user", userID)
		}
		if old.SHA256 != sha {
			d.cache.Remove(userID, old.SHA256)
		}
	}
	return nil
}

// upload puts one file in its folder under a readable name, and returns it
// with the MIME type it was given. Nothing is recorded: that is the
// caller's next step.
func (d *Drive) upload(ctx context.Context, userID uuid.UUID, kind, key string, body io.ReaderAt, size int64, sha string) (RemoteFile, string, error) {
	head := make([]byte, min(512, size))
	n, err := body.ReadAt(head, 0)
	if err != nil && !errors.Is(err, io.EOF) {
		return RemoteFile{}, "", err
	}
	title, mimeType := d.title(ctx, userID, kind, key)
	if mimeType == "" {
		mimeType = sniffMIME(head[:n])
		// A recording or an overview is sound, whatever its container
		// sniffs as (WebM sniffs as video).
		if (kind == "recordings" || kind == "audio") && strings.HasPrefix(mimeType, "video/") {
			mimeType = "audio/" + strings.TrimPrefix(mimeType, "video/")
		}
	}
	rf, err := d.remote.Put(ctx, userID, RemoteUpload{
		Folder: driveFolders[kind],
		Name:   FileName(title, kind, mimeType, d.now()),
		MIME:   mimeType,
		Kind:   kind, Key: key, SHA256: sha,
		Size: size,
		Body: body,
	})
	return rf, mimeType, err
}

// readAll reads a whole file: from the cache, else from Drive, checked
// against its recorded digest before anyone sees it.
func (d *Drive) readAll(ctx context.Context, row *DriveFile) ([]byte, error) {
	if row.MissingAt != nil {
		return nil, ErrRemoved
	}
	if f, ok := d.cache.Open(row.UserID, row.SHA256, row.Bytes); ok {
		defer f.Close()
		data, over, err := ReadAllLimited(f, row.Bytes)
		if err == nil && !over && Digest(data) == row.SHA256 {
			return data, nil
		}
		// A cache entry that no longer matches is dropped and read again.
		d.cache.Remove(row.UserID, row.SHA256)
	}
	rc, err := d.remoteOpen(ctx, row)
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	data, over, err := ReadAllLimited(rc, row.Bytes)
	if err != nil {
		return nil, err
	}
	if over || int64(len(data)) != row.Bytes || Digest(data) != row.SHA256 {
		return nil, ErrCorrupt
	}
	d.cachePut(row.UserID, data)
	return data, nil
}

// open opens a file for streaming: the cached copy, else a ranged reader over
// Drive. A miss that is read straight through fills the cache as it goes.
func (d *Drive) open(ctx context.Context, row *DriveFile) (*File, error) {
	if row.MissingAt != nil {
		return nil, ErrRemoved
	}
	if f, ok := d.cache.Open(row.UserID, row.SHA256, row.Bytes); ok {
		f.ModTime = row.CreatedAt
		return f, nil
	}
	rc, err := d.remoteOpen(ctx, row)
	if err != nil {
		return nil, err
	}
	r := &fillingReader{ReadSeekCloser: rc, size: row.Bytes, want: row.SHA256}
	if row.Bytes <= d.cache.Max() {
		if stage, err := d.cache.Stage(row.UserID); err == nil {
			r.stage = stage
		}
	}
	return &File{ReadSeekCloser: r, Size: row.Bytes, ModTime: row.CreatedAt}, nil
}

func (d *Drive) remoteOpen(ctx context.Context, row *DriveFile) (io.ReadSeekCloser, error) {
	rc, err := d.remote.Open(ctx, row.UserID, row.DriveFileID, row.Bytes)
	if errors.Is(err, ErrRemoved) {
		if merr := d.index.MarkDriveFileMissing(ctx, row.UserID, row.Kind, row.Key); merr != nil {
			slog.Warn("blob: could not record a file removed from Drive", "error", merr, "user", row.UserID)
		}
	}
	return rc, err
}

// delete removes a file from Drive, then its row, then its cached copy. With
// no row there is nothing in Drive to delete.
//
// A Drive that needs reconnecting does not stop the learner deleting the
// AnyTools side (phase 3): the row and the cached copy go, and the file
// stays in their Drive, which is theirs to keep or delete.
func (d *Drive) delete(ctx context.Context, userID uuid.UUID, kind, key string) error {
	row, err := d.index.GetDriveFile(ctx, userID, kind, key)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := d.remote.Delete(ctx, userID, row.DriveFileID); err != nil {
		if !errors.Is(err, ErrReconnect) {
			return err
		}
		slog.Info("blob: Drive needs reconnecting; the file stays in the learner's Drive", "user", userID, "kind", kind)
	}
	if err := d.index.DeleteDriveFile(ctx, userID, kind, key); err != nil {
		return err
	}
	d.cache.Remove(userID, row.SHA256)
	return nil
}

func (d *Drive) cachePut(userID uuid.UUID, data []byte) {
	if err := d.cache.Put(userID, data); err != nil {
		slog.Warn("blob: could not cache a Drive file", "error", err, "user", userID)
	}
}

// fillingReader passes a ranged Drive reader through, copying what it reads
// into a staged cache entry while the reads are contiguous from the start.
// The entry is committed only when the whole file has passed and its digest
// matches; a seek that skips ahead abandons it. A full read whose digest does
// not match ends in ErrCorrupt, so a copy (media.Materialize) fails instead
// of handing ffmpeg the wrong bytes.
type fillingReader struct {
	io.ReadSeekCloser
	stage *Staged
	want  string
	size  int64
	pos   int64
}

func (r *fillingReader) Read(p []byte) (int, error) {
	start := r.pos
	n, err := r.ReadSeekCloser.Read(p)
	r.pos += int64(n)
	if r.stage == nil {
		return n, err
	}
	if start != r.stage.Len() {
		r.stage.Discard()
		r.stage = nil
		return n, err
	}
	if _, werr := r.stage.Write(p[:n]); werr != nil {
		r.stage.Discard()
		r.stage = nil
		return n, err
	}
	if r.stage.Len() == r.size {
		stage := r.stage
		r.stage = nil
		if cerr := stage.CommitAs(r.want); errors.Is(cerr, ErrCorrupt) {
			return n, ErrCorrupt
		}
	}
	return n, err
}

func (r *fillingReader) Seek(offset int64, whence int) (int64, error) {
	pos, err := r.ReadSeekCloser.Seek(offset, whence)
	if err == nil {
		r.pos = pos
	}
	return pos, err
}

func (r *fillingReader) Close() error {
	if r.stage != nil {
		r.stage.Discard()
		r.stage = nil
	}
	return r.ReadSeekCloser.Close()
}

// ──────────────────────────────────────────────────────────────── names

// kindLabels name a file whose title is unknown (an original is stored
// before its document row exists).
var kindLabels = map[string]string{
	KindOriginal:  "Upload",
	"recordings":  "Recording",
	"audio":       "Audio overview",
	"exam_papers": "Exam paper",
	"photopages":  "Page photo",
}

// extensions Drive and a desktop both recognise, for the types AnyTools
// stores. mime.ExtensionsByType covers the rest.
var extensions = map[string]string{
	"application/pdf": ".pdf",
	"audio/wave":      ".wav",
	"audio/wav":       ".wav",
	"audio/webm":      ".webm",
	"video/webm":      ".webm",
	"audio/ogg":       ".ogg",
	"application/ogg": ".ogg",
	"audio/mp4":       ".m4a",
	"video/mp4":       ".mp4",
	"audio/mpeg":      ".mp3",
	"image/jpeg":      ".jpg",
	"image/png":       ".png",
	"image/webp":      ".webp",
	"text/plain":      ".txt",
	"text/html":       ".html",
	"application/zip": ".zip",
}

// FileName is what a file is called in Drive: its title and its type, or a
// label and the date when the title is unknown. Never an id alone.
func FileName(title, kind, mimeType string, at time.Time) string {
	title = cleanTitle(title)
	if title == "" {
		label := kindLabels[kind]
		if label == "" {
			label = "File"
		}
		title = label + " " + at.Format("2006-01-02 15.04")
	}
	ext := extensions[mimeType]
	if ext == "" {
		if all, _ := mime.ExtensionsByType(mimeType); len(all) > 0 {
			ext = all[0]
		}
	}
	if ext != "" && !strings.HasSuffix(strings.ToLower(title), ext) {
		title += ext
	}
	return title
}

// cleanTitle keeps a title readable as a file name: no control characters,
// no path separators, at most 150 characters.
func cleanTitle(s string) string {
	s = strings.Map(func(r rune) rune {
		switch {
		case r == '/' || r == '\\':
			return '-'
		case unicode.IsControl(r):
			return -1
		}
		return r
	}, s)
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > 150 {
		s = strings.TrimSpace(string(r[:150]))
	}
	return s
}

func sniffMIME(head []byte) string {
	t := http.DetectContentType(head)
	if i := strings.IndexByte(t, ';'); i >= 0 {
		t = t[:i]
	}
	return strings.TrimSpace(t)
}
