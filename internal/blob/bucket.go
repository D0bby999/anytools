// bucket.go — the server's own copy of a learner's files in an object store
// (Cloudflare R2) instead of on its disk.
//
// With a Bucket, Local keeps every original and every object under the same
// key it would use as a path below the data directory ("originals/<user>/
// <dd>/<digest>", "objects/<user>/<namespace>/<id>"), so nothing above Local
// changes: the router, the Drive backend and the moves between them all ask
// Local, and Local asks the bucket. What is derived or temporary stays on the
// disk: parsed Markdown (read on every search), job directories, the Drive
// cache.
//
// A file written before the bucket was configured is still on the disk. Reads
// look in the bucket first and fall back to the disk; deletes remove both; a
// write to the bucket removes the disk's copy. Nothing has to be copied by
// hand when a server starts using a bucket.
//
// The bucket is private. Files reach a browser only through the API, after
// the same ownership checks as files on the disk; nothing here makes a URL.
package blob

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Bucket is an object store keyed by slash-separated names.
// internal/connectors/r2 implements it over R2's S3 API; this package knows
// nothing about S3.
type Bucket interface {
	// Put stores size bytes read from body under key, replacing any object
	// there. body may be read more than once (a retry seeks it back).
	Put(ctx context.Context, key string, body io.ReadSeeker, size int64) error
	// Get reads key from offset to its end. A missing key is ErrNotFound.
	Get(ctx context.Context, key string, offset int64) (io.ReadCloser, error)
	// Stat describes key. A missing key is ErrNotFound.
	Stat(ctx context.Context, key string) (BucketObject, error)
	// Delete removes keys. A missing key is not an error.
	Delete(ctx context.Context, keys ...string) error
	// List describes every key that starts with prefix.
	List(ctx context.Context, prefix string) ([]BucketObject, error)
}

// BucketObject is one stored object.
type BucketObject struct {
	Key     string
	Size    int64
	ModTime time.Time
}

// NewLocalWithBucket returns a Local that keeps originals and objects in b
// and everything else under dir.
func NewLocalWithBucket(dir string, b Bucket) (*Local, error) {
	l, err := NewLocal(dir)
	if err != nil {
		return nil, err
	}
	l.bucket = b
	l.sweepTemp(time.Now().Add(-2 * time.Hour))
	return l, nil
}

// sweepTemp removes scratch files a killed process left in tmp (a deferred
// removal does not run then), older than cutoff so no live write owns them.
func (l *Local) sweepTemp(cutoff time.Time) {
	dir := filepath.Join(l.root, "tmp")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		info, err := e.Info()
		if err == nil && strings.HasPrefix(e.Name(), ".tmp-blob-") && info.ModTime().Before(cutoff) {
			os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}

// InBucket reports whether originals and objects go to a bucket.
func (l *Local) InBucket() bool { return l.bucket != nil }

// key is a path below the data directory as a bucket key. Paths come from
// originalPath and objectPath, which build them from uuids and digests.
func (l *Local) key(path string) (string, error) {
	rel, err := filepath.Rel(l.root, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("blob: path escapes the data directory")
	}
	return filepath.ToSlash(rel), nil
}

// putFile stores data at path: in the bucket, or on the disk.
func (l *Local) putFile(ctx context.Context, path string, data []byte) error {
	if l.bucket == nil {
		return writeFileAtomic(path, data)
	}
	key, err := l.key(path)
	if err != nil {
		return err
	}
	if err := l.bucket.Put(ctx, key, bytes.NewReader(data), int64(len(data))); err != nil {
		return err
	}
	return removeFile(path) // an older copy from before the bucket
}

// putFrom stores a finished temporary file at path's key and removes it.
func (l *Local) putFrom(ctx context.Context, path string, f *os.File) error {
	key, err := l.key(path)
	if err != nil {
		return err
	}
	info, err := f.Stat()
	if err != nil {
		return err
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	if err := l.bucket.Put(ctx, key, f, info.Size()); err != nil {
		return err
	}
	return removeFile(path)
}

// readFile reads path back: from the bucket, else from the disk.
func (l *Local) readFile(ctx context.Context, path string) ([]byte, error) {
	if l.bucket != nil {
		key, err := l.key(path)
		if err != nil {
			return nil, err
		}
		rc, err := l.bucket.Get(ctx, key, 0)
		if err == nil {
			defer rc.Close()
			return io.ReadAll(rc)
		}
		if !errors.Is(err, ErrNotFound) {
			return nil, err
		}
	}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	return b, err
}

// openAt opens path for streaming: from the bucket, else from the disk.
func (l *Local) openAt(ctx context.Context, path string) (*File, error) {
	if l.bucket != nil {
		key, err := l.key(path)
		if err != nil {
			return nil, err
		}
		obj, err := l.bucket.Stat(ctx, key)
		if err == nil {
			// The request's context ends with the request; a File outlives
			// neither.
			return &File{ReadSeekCloser: &rangeReader{ctx: ctx, b: l.bucket, key: key, size: obj.Size}, Size: obj.Size, ModTime: obj.ModTime}, nil
		}
		if !errors.Is(err, ErrNotFound) {
			return nil, err
		}
	}
	return openFile(path)
}

// removeAt deletes path from the bucket and from the disk. Missing is not an
// error.
func (l *Local) removeAt(ctx context.Context, path string) error {
	if l.bucket != nil {
		key, err := l.key(path)
		if err != nil {
			return err
		}
		if err := l.bucket.Delete(ctx, key); err != nil {
			return err
		}
	}
	return removeFile(path)
}

// removeUserKeys deletes every key of a learner's originals and objects.
func (l *Local) removeUserKeys(ctx context.Context, userID uuid.UUID) error {
	if l.bucket == nil {
		return nil
	}
	for _, kind := range []string{"originals", "objects"} {
		objs, err := l.bucket.List(ctx, kind+"/"+userID.String()+"/")
		if err != nil {
			return err
		}
		keys := make([]string, len(objs))
		for i, o := range objs {
			keys[i] = o.Key
		}
		if err := l.bucket.Delete(ctx, keys...); err != nil {
			return err
		}
	}
	return nil
}

// tempFile is a scratch file under the data directory's tmp, for a write
// that must be whole before it is sent to the bucket.
func (l *Local) tempFile() (*os.File, error) {
	dir := filepath.Join(l.root, "tmp")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("blob: create dir: %w", err)
	}
	return os.CreateTemp(dir, ".tmp-blob-*")
}

// moveSource opens path for a move to Drive as a file on the disk, since a
// move reads it twice (its checksums, then the upload). From the bucket that
// is a scratch copy, removed by done. Missing is fs.ErrNotExist.
func (l *Local) moveSource(ctx context.Context, path string) (f *os.File, done func(), err error) {
	if l.bucket != nil {
		key, err := l.key(path)
		if err != nil {
			return nil, nil, err
		}
		rc, err := l.bucket.Get(ctx, key, 0)
		switch {
		case err == nil:
			defer rc.Close()
			tmp, err := l.tempFile()
			if err != nil {
				return nil, nil, err
			}
			drop := func() { tmp.Close(); os.Remove(tmp.Name()) }
			if _, err := io.Copy(tmp, rc); err != nil {
				drop()
				return nil, nil, err
			}
			return tmp, drop, nil
		case !errors.Is(err, ErrNotFound):
			return nil, nil, err
		}
	}
	f, err = os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	return f, func() { f.Close() }, nil
}

// writeCheckedAt is writeChecked to path's place: the bucket or the disk.
func (l *Local) writeCheckedAt(ctx context.Context, path string, r io.Reader, size int64, want string) error {
	if l.bucket == nil {
		return writeChecked(path, r, size, want)
	}
	tmp, err := l.tempFile()
	if err != nil {
		return err
	}
	name := tmp.Name()
	tmp.Close()
	os.Remove(name)
	if err := writeChecked(name, r, size, want); err != nil {
		return err
	}
	defer os.Remove(name)
	f, err := os.Open(name)
	if err != nil {
		return err
	}
	defer f.Close()
	return l.putFrom(ctx, path, f)
}

// listBucket calls fn for every key under prefix, as a path below the data
// directory.
func (l *Local) listBucket(ctx context.Context, prefix string, fn func(path string, size int64)) error {
	if l.bucket == nil {
		return nil
	}
	objs, err := l.bucket.List(ctx, prefix)
	if err != nil {
		return err
	}
	for _, o := range objs {
		fn(filepath.Join(l.root, filepath.FromSlash(o.Key)), o.Size)
	}
	return nil
}

// rangeReader reads an object as a seekable stream for http.ServeContent: a
// player's range request seeks, and only the bytes from there on are fetched.
// A read after a seek opens the object again at the new offset; reads in
// order share one response.
type rangeReader struct {
	ctx  context.Context
	b    Bucket
	key  string
	size int64
	off  int64
	body io.ReadCloser
}

func (r *rangeReader) Read(p []byte) (int, error) {
	if r.off >= r.size {
		return 0, io.EOF
	}
	if r.body == nil {
		body, err := r.b.Get(r.ctx, r.key, r.off)
		if err != nil {
			return 0, err
		}
		r.body = body
	}
	n, err := r.body.Read(p)
	r.off += int64(n)
	if errors.Is(err, io.EOF) && r.off < r.size {
		err = io.ErrUnexpectedEOF
	}
	return n, err
}

func (r *rangeReader) Seek(offset int64, whence int) (int64, error) {
	var abs int64
	switch whence {
	case io.SeekStart:
		abs = offset
	case io.SeekCurrent:
		abs = r.off + offset
	case io.SeekEnd:
		abs = r.size + offset
	default:
		return 0, errors.New("blob: invalid whence")
	}
	if abs < 0 {
		return 0, errors.New("blob: negative position")
	}
	if abs != r.off && r.body != nil {
		r.body.Close()
		r.body = nil
	}
	r.off = abs
	return abs, nil
}

func (r *rangeReader) Close() error {
	if r.body == nil {
		return nil
	}
	err := r.body.Close()
	r.body = nil
	return err
}
