// Package blob stores uploaded files and parsed Markdown. Local keeps them on
// the server's disk; Router (router.go) picks, per learner, where their own
// files live.
//
// Two properties of Local are load-bearing and both are structural rather than
// procedural:
//
//   - Files live under ANYTOOLS_DATA_DIR, which is NOT inside any web root.
//     The RR7 BFF serves `ui/web/build/client`; nothing under the data
//     directory is reachable by URL, so an uploaded `.html` can never be
//     served back to a browser as same-origin content.
//   - Every path segment is derived from a uuid or a hex digest that this
//     package computes itself. No caller-supplied filename ever reaches the
//     filesystem, so path traversal is not a bug to be prevented — it is not
//     expressible.
package blob

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/google/uuid"
)

// ErrNotFound is returned when a blob or parsed document is absent.
var ErrNotFound = errors.New("blob: not found")

// Store is the persistence surface the knowledge service consumes. Local
// implements it, and Router routes it per learner (drive-user-storage
// phase 0), so a learner's files can live in their own Google Drive.
type Store interface {
	// PutOriginal writes the uploaded bytes and returns their sha256.
	PutOriginal(ctx context.Context, userID uuid.UUID, data []byte) (sha256hex string, err error)
	// GetOriginal reads bytes back by digest.
	GetOriginal(ctx context.Context, userID uuid.UUID, sha256hex string) ([]byte, error)
	// OpenOriginal opens a large original (an uploaded recording) for
	// streaming, without reading it into memory. The caller closes it.
	OpenOriginal(ctx context.Context, userID uuid.UUID, sha256hex string) (*File, error)
	// PutParsed writes the parsed Markdown for one document version and
	// returns the path recorded on the document row.
	PutParsed(ctx context.Context, userID, docID uuid.UUID, version int, markdown string) (string, error)
	// GetParsed reads parsed Markdown back by the path PutParsed returned.
	GetParsed(ctx context.Context, path string) (string, error)
	// DeleteDocument removes every artifact belonging to a document.
	DeleteDocument(ctx context.Context, userID, docID uuid.UUID) error
	// DeleteOriginal removes one uploaded original by digest. The caller
	// decides that no document still names it.
	DeleteOriginal(ctx context.Context, userID uuid.UUID, sha256hex string) error
	// DeleteUser removes every file belonging to a user (account deletion).
	DeleteUser(ctx context.Context, userID uuid.UUID) error
}

// ObjectStore keeps files that belong to ONE row: an exam paper, an audio
// overview. Originals are addressed by content, so two rows with the same
// bytes share one file, and deleting it for one row deletes it for the other
// (learning-depth red team SF-10). An object's key is its row's id instead, so
// it lives and dies with that row. DeleteUser still removes them all.
type ObjectStore interface {
	PutObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID, data []byte) error
	GetObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) ([]byte, error)
	// OpenObject opens a large object (audio) for streaming, without reading
	// it into memory. The caller closes it.
	OpenObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) (*File, error)
	// WriteObject streams a large object (an audio overview joined from its
	// parts) into place atomically, without holding it in memory.
	WriteObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID, write func(io.Writer) error) error
	DeleteObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) error
}

// File is a stored file opened for reading. It seeks, so http.ServeContent
// answers a player's range requests from it, and it carries the size and the
// modification time ServeContent and a WAV header need.
//
// Callers never get a path: a file may live somewhere a path cannot name
// (drive-user-storage phase 1). A tool that needs one (ffmpeg) copies the
// stream into its job directory (media.Materialize).
type File struct {
	io.ReadSeekCloser
	Size    int64
	ModTime time.Time
}

var (
	_ Store       = (*Local)(nil)
	_ ObjectStore = (*Local)(nil)
)

// Local is a Store backed by a directory tree, or, given a Bucket
// (bucket.go), by an object store for originals and objects with the tree
// for the rest.
type Local struct {
	root   string
	bucket Bucket
}

// NewLocal returns a Local rooted at dir, creating it if needed.
func NewLocal(dir string) (*Local, error) {
	if dir == "" {
		return nil, errors.New("blob: data directory is empty")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, fmt.Errorf("blob: resolve data dir: %w", err)
	}
	// 0o700: the tree holds other people's documents. A group-readable upload
	// directory is a data leak on any box with more than one service account.
	if err := os.MkdirAll(abs, 0o700); err != nil {
		return nil, fmt.Errorf("blob: create data dir: %w", err)
	}
	return &Local{root: abs}, nil
}

// Root is the absolute data directory, for diagnostics.
func (l *Local) Root() string { return l.root }

// Digest returns the sha256 of data as lowercase hex. Exported because the
// upload handler needs the digest before it decides whether to store anything.
func Digest(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func (l *Local) originalPath(userID uuid.UUID, digest string) (string, error) {
	if err := validDigest(digest); err != nil {
		return "", err
	}
	// Two-character fan-out: a single directory with 100k entries is slow to
	// list and slow to stat on every filesystem this will ever run on.
	return filepath.Join(l.root, "originals", userID.String(), digest[:2], digest), nil
}

// objectPath is objects/<user>/<namespace>/<id>. The namespace is a constant
// in the calling package, checked here anyway: lowercase letters, digits and
// underscores, so it cannot name a parent directory.
func (l *Local) objectPath(userID uuid.UUID, namespace string, id uuid.UUID) (string, error) {
	if namespace == "" || len(namespace) > 32 {
		return "", fmt.Errorf("blob: malformed namespace")
	}
	for _, r := range namespace {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '_' {
			return "", fmt.Errorf("blob: malformed namespace")
		}
	}
	if userID == uuid.Nil || id == uuid.Nil {
		return "", fmt.Errorf("blob: nil id")
	}
	return filepath.Join(l.root, "objects", userID.String(), namespace, id.String()), nil
}

// PutObject writes (or replaces) one row's file.
func (l *Local) PutObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID, data []byte) error {
	path, err := l.objectPath(userID, namespace, id)
	if err != nil {
		return err
	}
	return l.putFile(ctx, path, data)
}

// GetObject reads one row's file back.
func (l *Local) GetObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) ([]byte, error) {
	path, err := l.objectPath(userID, namespace, id)
	if err != nil {
		return nil, err
	}
	return l.readFile(ctx, path)
}

// OpenObject opens one row's file for streaming.
func (l *Local) OpenObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) (*File, error) {
	path, err := l.objectPath(userID, namespace, id)
	if err != nil {
		return nil, err
	}
	return l.openAt(ctx, path)
}

// WriteObject streams one row's file through a temp file and renames it into
// place, so a reader never sees half of it and a failed write leaves nothing.
// With a bucket the finished temp file is uploaded instead.
func (l *Local) WriteObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID, write func(io.Writer) error) error {
	path, err := l.objectPath(userID, namespace, id)
	if err != nil {
		return err
	}
	if l.bucket != nil {
		f, err := l.tempFile()
		if err != nil {
			return err
		}
		defer func() { f.Close(); os.Remove(f.Name()) }()
		if err := write(f); err != nil {
			return err
		}
		return l.putFrom(ctx, path, f)
	}
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
	if err := write(f); err != nil {
		f.Close()
		return err
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

// DeleteObject removes one row's file. A missing file is not an error.
func (l *Local) DeleteObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) error {
	path, err := l.objectPath(userID, namespace, id)
	if err != nil {
		return err
	}
	return l.removeAt(ctx, path)
}

func (l *Local) parsedPath(userID, docID uuid.UUID, version int) string {
	return filepath.Join(l.root, "parsed", userID.String(),
		docID.String()+"-v"+strconv.Itoa(version)+".md")
}

// PutOriginal writes data under its own digest. Writing the same bytes twice is
// a no-op, which is what makes an interrupted upload safe to retry.
func (l *Local) PutOriginal(ctx context.Context, userID uuid.UUID, data []byte) (string, error) {
	digest := Digest(data)
	path, err := l.originalPath(userID, digest)
	if err != nil {
		return "", err
	}
	if err := l.putFile(ctx, path, data); err != nil {
		return "", err
	}
	return digest, nil
}

// GetOriginal reads bytes back by digest.
func (l *Local) GetOriginal(ctx context.Context, userID uuid.UUID, digest string) ([]byte, error) {
	path, err := l.originalPath(userID, digest)
	if err != nil {
		return nil, err
	}
	return l.readFile(ctx, path)
}

// OpenOriginal opens an original for streaming.
func (l *Local) OpenOriginal(ctx context.Context, userID uuid.UUID, digest string) (*File, error) {
	path, err := l.originalPath(userID, digest)
	if err != nil {
		return nil, err
	}
	return l.openAt(ctx, path)
}

// openFile opens a stored file with its size and time. A missing file is
// ErrNotFound, like the Get methods.
func openFile(path string) (*File, error) {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	return &File{ReadSeekCloser: f, Size: info.Size(), ModTime: info.ModTime()}, nil
}

// PutParsed writes one version's Markdown and returns the stored path.
//
// The version is in the filename on purpose: a re-parse that fails partway
// must not have overwritten the copy the document viewer is serving right now.
func (l *Local) PutParsed(_ context.Context, userID, docID uuid.UUID, version int, markdown string) (string, error) {
	path := l.parsedPath(userID, docID, version)
	if err := writeFileAtomic(path, []byte(markdown)); err != nil {
		return "", err
	}
	return path, nil
}

// GetParsed reads Markdown back.
//
// The path argument comes from `documents.parsed_markdown_path`, a column only
// this package ever writes — but it is still confined to the data root, because
// "only this package writes it" is an invariant a future migration or a manual
// UPDATE can break, and the cost of checking is one string comparison.
func (l *Local) GetParsed(_ context.Context, path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(l.root, abs)
	if err != nil || rel == ".." || len(rel) >= 3 && rel[:3] == ".."+string(filepath.Separator) {
		return "", fmt.Errorf("blob: parsed path escapes the data directory")
	}
	b, err := os.ReadFile(abs)
	if errors.Is(err, os.ErrNotExist) {
		return "", ErrNotFound
	}
	return string(b), err
}

// DeleteDocument removes every parsed version of a document.
//
// The original is not touched here: it is addressed by content digest and
// may be shared by another document; knowledge.Service decides and calls
// DeleteOriginal.
func (l *Local) DeleteDocument(_ context.Context, userID, docID uuid.UUID) error {
	dir := filepath.Join(l.root, "parsed", userID.String())
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	prefix := docID.String() + "-v"
	for _, e := range entries {
		name := e.Name()
		if len(name) > len(prefix) && name[:len(prefix)] == prefix {
			if err := os.Remove(filepath.Join(dir, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	}
	return nil
}

// writeFileAtomic writes through a temp file in the destination directory and
// renames. A torn write would otherwise leave a truncated PDF that parses to
// garbage and a digest that no longer matches its own filename.
func writeFileAtomic(path string, data []byte) error {
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

	if _, err := f.Write(data); err != nil {
		f.Close()
		return fmt.Errorf("blob: write: %w", err)
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
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("blob: rename: %w", err)
	}
	return nil
}

// ReadAllLimited reads at most limit bytes and reports whether more remained.
// Used by the upload handler so an oversized body is rejected by size rather
// than buffered first.
func ReadAllLimited(r io.Reader, limit int64) ([]byte, bool, error) {
	data, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, false, err
	}
	if int64(len(data)) > limit {
		return nil, true, nil
	}
	return data, false, nil
}

// DeleteOriginal removes one original. A missing file is not an error: the
// state asked for is "gone".
func (l *Local) DeleteOriginal(ctx context.Context, userID uuid.UUID, digest string) error {
	p, err := l.originalPath(userID, digest)
	if err != nil {
		return err
	}
	return l.removeAt(ctx, p)
}

// CacheDir is the directory under the data directory that holds the cache
// of files kept in learners' Drives (cache.go).
const CacheDir = "cache"

// DeleteUser removes every file belonging to a user: their originals, their
// parsed Markdown, their per-row objects and their cached Drive files. Account deletion calls it after the database rows are gone,
// so a failure here leaves files nobody can reach rather than rows pointing at
// missing files. The cache is removed here too, not only by the Drive
// backend, so a deployment that has since turned Drive off still removes it.
// With a bucket, their keys there go first.
func (l *Local) DeleteUser(ctx context.Context, userID uuid.UUID) error {
	if err := l.removeUserKeys(ctx, userID); err != nil {
		return err
	}
	for _, kind := range []string{"originals", "parsed", "objects", CacheDir} {
		if err := os.RemoveAll(filepath.Join(l.root, kind, userID.String())); err != nil {
			return err
		}
	}
	return nil
}
