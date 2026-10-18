package blob_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
)

// drive_test.go — the Drive backend against an in-memory Drive and index.
// What Google itself answers is internal/connectors/drive's business, proven
// there against recorded fixtures; here the question is what the backend does
// with those answers.

type remoteFile struct {
	up   blob.RemoteUpload
	data []byte
}

// fakeRemote is a learner's Drive, per user.
type fakeRemote struct {
	mu      sync.Mutex
	files   map[string]*remoteFile // id → file
	owner   map[string]uuid.UUID
	n       int
	puts    int
	opens   int
	deletes []string

	putErr  error
	delErr  error           // Delete fails with it (phase 3)
	corrupt bool            // Open serves other bytes than were written
	removed map[string]bool // ids the learner deleted in Drive
}

func newFakeRemote() *fakeRemote {
	return &fakeRemote{files: map[string]*remoteFile{}, owner: map[string]uuid.UUID{}, removed: map[string]bool{}}
}

func (r *fakeRemote) Put(_ context.Context, u uuid.UUID, up blob.RemoteUpload) (blob.RemoteFile, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.puts++
	if r.putErr != nil {
		return blob.RemoteFile{}, r.putErr
	}
	data, err := io.ReadAll(io.NewSectionReader(up.Body, 0, up.Size))
	if err != nil {
		return blob.RemoteFile{}, err
	}
	if int64(len(data)) != up.Size || blob.Digest(data) != up.SHA256 {
		return blob.RemoteFile{}, fmt.Errorf("fake remote: received %d bytes, not the %d announced", len(data), up.Size)
	}
	r.n++
	id := fmt.Sprintf("file%03d", r.n)
	up.Body = nil
	r.files[id] = &remoteFile{up: up, data: data}
	r.owner[id] = u
	return blob.RemoteFile{ID: id}, nil
}

type nopSeekCloser struct{ *bytes.Reader }

func (nopSeekCloser) Close() error { return nil }

func (r *fakeRemote) Open(_ context.Context, u uuid.UUID, id string, size int64) (io.ReadSeekCloser, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.opens++
	f, ok := r.files[id]
	if !ok || r.owner[id] != u || r.removed[id] {
		return nil, blob.ErrRemoved
	}
	if int64(len(f.data)) != size {
		return nil, blob.ErrCorrupt
	}
	data := f.data
	if r.corrupt {
		data = bytes.ToUpper(data)
	}
	return nopSeekCloser{bytes.NewReader(data)}, nil
}

func (r *fakeRemote) Delete(_ context.Context, u uuid.UUID, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.deletes = append(r.deletes, id)
	if r.delErr != nil {
		return r.delErr
	}
	if r.owner[id] == u {
		delete(r.files, id)
	}
	return nil
}

func (r *fakeRemote) only(t *testing.T) *remoteFile {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.files) != 1 {
		t.Fatalf("Drive holds %d files, want 1", len(r.files))
	}
	for _, f := range r.files {
		return f
	}
	return nil
}

type indexKey struct {
	user      uuid.UUID
	kind, key string
}

// fakeIndex is drive_files, scoped by user like the real table.
type fakeIndex struct {
	mu     sync.Mutex
	rows   map[indexKey]blob.DriveFile
	putErr error
}

func newFakeIndex() *fakeIndex { return &fakeIndex{rows: map[indexKey]blob.DriveFile{}} }

func (x *fakeIndex) GetDriveFile(_ context.Context, u uuid.UUID, kind, key string) (*blob.DriveFile, error) {
	x.mu.Lock()
	defer x.mu.Unlock()
	f, ok := x.rows[indexKey{u, kind, key}]
	if !ok {
		return nil, blob.ErrNotFound
	}
	return &f, nil
}

func (x *fakeIndex) PutDriveFile(_ context.Context, f blob.DriveFile) error {
	x.mu.Lock()
	defer x.mu.Unlock()
	if x.putErr != nil {
		return x.putErr
	}
	f.CreatedAt = time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	f.MissingAt = nil
	x.rows[indexKey{f.UserID, f.Kind, f.Key}] = f
	return nil
}

func (x *fakeIndex) DeleteDriveFile(_ context.Context, u uuid.UUID, kind, key string) error {
	x.mu.Lock()
	defer x.mu.Unlock()
	delete(x.rows, indexKey{u, kind, key})
	return nil
}

func (x *fakeIndex) MarkDriveFileMissing(_ context.Context, u uuid.UUID, kind, key string) error {
	x.mu.Lock()
	defer x.mu.Unlock()
	k := indexKey{u, kind, key}
	if f, ok := x.rows[k]; ok {
		now := time.Now()
		f.MissingAt = &now
		x.rows[k] = f
	}
	return nil
}

type driveFixture struct {
	local  *blob.Local
	remote *fakeRemote
	index  *fakeIndex
	cache  *blob.Cache
	cdir   string
	drive  *blob.Drive
}

func newDriveFixture(t *testing.T) *driveFixture {
	t.Helper()
	local, _ := newStore(t)
	f := &driveFixture{local: local, remote: newFakeRemote(), index: newFakeIndex(), cdir: t.TempDir()}
	f.reopenCache(t, 1<<20)
	return f
}

// reopenCache swaps in an empty cache, so the next read goes to Drive.
func (f *driveFixture) reopenCache(t *testing.T, max int64) {
	t.Helper()
	f.cdir = t.TempDir()
	cache, err := blob.NewCache(f.cdir, max)
	if err != nil {
		t.Fatal(err)
	}
	f.cache = cache
	d, err := blob.NewDrive(blob.DriveConfig{
		Local: f.local, Remote: f.remote, Index: f.index, Cache: cache,
		Title: func(_ context.Context, _ uuid.UUID, kind, _ string) (string, string) {
			switch kind {
			case "recordings":
				return "", "audio/webm"
			case "audio":
				return "Week 3 overview", ""
			}
			return "", ""
		},
		Now: func() time.Time { return time.Date(2026, 10, 17, 19, 48, 0, 0, time.UTC) },
	})
	if err != nil {
		t.Fatal(err)
	}
	f.drive = d
}

func serverHas(t *testing.T, root string, kind string, user uuid.UUID) bool {
	t.Helper()
	found := false
	_ = filepath.Walk(filepath.Join(root, kind, user.String()), func(_ string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			found = true
		}
		return nil
	})
	return found
}

func TestDriveKeepsALearnersFilesInDriveAndDerivedOnesOnTheServer(t *testing.T) {
	f := newDriveFixture(t)
	ctx, user := context.Background(), uuid.New()
	pdf := []byte("%PDF-1.7 a learner's upload")

	digest, err := f.drive.PutOriginal(ctx, user, pdf)
	if err != nil {
		t.Fatal(err)
	}
	up := f.remote.only(t).up
	if up.Folder != blob.FolderUploads || up.Kind != blob.KindOriginal || up.Key != digest || up.SHA256 != digest {
		t.Fatalf("uploaded as %+v", up)
	}
	if up.MIME != "application/pdf" || up.Name != "Upload 2026-10-17 19.48.pdf" {
		t.Fatalf("named %q (%s)", up.Name, up.MIME)
	}
	if serverHas(t, f.local.Root(), "originals", user) {
		t.Fatal("the original was also written to the server's disk")
	}
	if got, err := f.drive.GetOriginal(ctx, user, digest); err != nil || !bytes.Equal(got, pdf) {
		t.Fatalf("read back %q, %v", got, err)
	}

	// A recording goes in Recordings, named by its type and the date.
	rec := uuid.New()
	if err := f.drive.PutObject(ctx, user, "recordings", rec, []byte("webm bytes")); err != nil {
		t.Fatal(err)
	}
	row, err := f.index.GetDriveFile(ctx, user, "recordings", rec.String())
	if err != nil {
		t.Fatal(err)
	}
	if got := f.remote.files[row.DriveFileID].up; got.Folder != blob.FolderRecordings || got.Name != "Recording 2026-10-17 19.48.webm" || got.MIME != "audio/webm" {
		t.Fatalf("recording uploaded as %+v", got)
	}

	// An overview is named after its own title.
	overview := uuid.New()
	if err := f.drive.PutObject(ctx, user, "audio", overview, []byte("RIFF....WAVEfmt ")); err != nil {
		t.Fatal(err)
	}
	row, _ = f.index.GetDriveFile(ctx, user, "audio", overview.String())
	if got := f.remote.files[row.DriveFileID].up; got.Folder != blob.FolderAudio || got.Name != "Week 3 overview.wav" {
		t.Fatalf("overview uploaded as %+v", got)
	}

	// Derived files stay on the server: a transcript window, the audio parts
	// an overview is joined from, parsed Markdown.
	before := f.remote.puts
	for _, ns := range []string{"transcripts", "audio_parts", "exam_parsed"} {
		if err := f.drive.PutObject(ctx, user, ns, uuid.New(), []byte("derived")); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.drive.PutParsed(ctx, user, uuid.New(), 1, "# parsed"); err != nil {
		t.Fatal(err)
	}
	if f.remote.puts != before {
		t.Fatalf("derived files reached Drive: %d uploads", f.remote.puts-before)
	}
	if !serverHas(t, f.local.Root(), "objects", user) || !serverHas(t, f.local.Root(), "parsed", user) {
		t.Fatal("derived files are not on the server")
	}
}

func TestDrivePutOriginalReusesTheSameBytes(t *testing.T) {
	f := newDriveFixture(t)
	ctx, user := context.Background(), uuid.New()
	for i := 0; i < 2; i++ {
		if _, err := f.drive.PutOriginal(ctx, user, []byte("same bytes")); err != nil {
			t.Fatal(err)
		}
	}
	if f.remote.puts != 1 {
		t.Fatalf("the same original was uploaded %d times", f.remote.puts)
	}
	// Another learner with the same bytes gets a file of their own.
	if _, err := f.drive.PutOriginal(ctx, uuid.New(), []byte("same bytes")); err != nil {
		t.Fatal(err)
	}
	if f.remote.puts != 2 {
		t.Fatalf("another learner reused this learner's file (%d uploads)", f.remote.puts)
	}
}

func TestDriveDeletesTheUploadWhenItCannotBeRecorded(t *testing.T) {
	f := newDriveFixture(t)
	f.index.putErr = errors.New("database down")
	ctx, user := context.Background(), uuid.New()
	if _, err := f.drive.PutOriginal(ctx, user, []byte("orphan?")); err == nil {
		t.Fatal("the write succeeded without its row")
	}
	if len(f.remote.files) != 0 || len(f.remote.deletes) != 1 {
		t.Fatalf("Drive holds %d files after %d deletes", len(f.remote.files), len(f.remote.deletes))
	}
}

func TestDriveRefusalWritesNothingToTheServer(t *testing.T) {
	f := newDriveFixture(t)
	quota := errors.New("drive: storage quota exceeded")
	f.remote.putErr = quota
	ctx, user := context.Background(), uuid.New()
	if _, err := f.drive.PutOriginal(ctx, user, []byte("too much")); !errors.Is(err, quota) {
		t.Fatalf("put original: %v", err)
	}
	if err := f.drive.WriteObject(ctx, user, "audio", uuid.New(), func(w io.Writer) error {
		_, err := w.Write([]byte("RIFF wav"))
		return err
	}); !errors.Is(err, quota) {
		t.Fatalf("write object: %v", err)
	}
	if serverHas(t, f.local.Root(), "originals", user) || serverHas(t, f.local.Root(), "objects", user) {
		t.Fatal("a refused upload fell back to the server's disk")
	}
	if total, temps := onDisk(t, f.cdir); total != 0 || temps != 0 {
		t.Fatalf("a refused upload left %d bytes and %d temporary files in the cache", total, temps)
	}
}

func TestDriveReadsFromTheCacheThenFromDrive(t *testing.T) {
	f := newDriveFixture(t)
	ctx, user := context.Background(), uuid.New()
	data := []byte("cached after the write")
	digest, err := f.drive.PutOriginal(ctx, user, data)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.drive.GetOriginal(ctx, user, digest); err != nil {
		t.Fatal(err)
	}
	if f.remote.opens != 0 {
		t.Fatalf("a freshly written file was read from Drive (%d opens)", f.remote.opens)
	}

	f.reopenCache(t, 1<<20)
	for i := 0; i < 2; i++ {
		if got, err := f.drive.GetOriginal(ctx, user, digest); err != nil || !bytes.Equal(got, data) {
			t.Fatalf("read %d: %q, %v", i, got, err)
		}
	}
	if f.remote.opens != 1 {
		t.Fatalf("Drive was opened %d times for two reads", f.remote.opens)
	}
}

func TestDriveRefusesAFileThatDoesNotMatchItsChecksum(t *testing.T) {
	f := newDriveFixture(t)
	ctx, user := context.Background(), uuid.New()
	digest, err := f.drive.PutOriginal(ctx, user, []byte("the real bytes"))
	if err != nil {
		t.Fatal(err)
	}
	id := uuid.New()
	if err := f.drive.PutObject(ctx, user, "audio", id, []byte("the real audio")); err != nil {
		t.Fatal(err)
	}
	f.reopenCache(t, 1<<20)
	f.remote.corrupt = true

	if _, err := f.drive.GetOriginal(ctx, user, digest); !errors.Is(err, blob.ErrCorrupt) {
		t.Fatalf("a corrupt original was served: %v", err)
	}
	file, err := f.drive.OpenObject(ctx, user, "audio", id)
	if err != nil {
		t.Fatal(err)
	}
	_, err = io.ReadAll(file)
	file.Close()
	if !errors.Is(err, blob.ErrCorrupt) {
		t.Fatalf("a full read of a corrupt stream ended with %v", err)
	}
	if total, _ := onDisk(t, f.cdir); total != 0 {
		t.Fatalf("a corrupt file was cached (%d bytes)", total)
	}
}

func TestDriveServesARangeFromDriveAndCachesOnlyWholeFiles(t *testing.T) {
	f := newDriveFixture(t)
	ctx, user, id := context.Background(), uuid.New(), uuid.New()
	data := []byte(strings.Repeat("0123456789", 500))
	if err := f.drive.PutObject(ctx, user, "recordings", id, data); err != nil {
		t.Fatal(err)
	}
	f.reopenCache(t, 1<<20)

	file, err := f.drive.OpenObject(ctx, user, "recordings", id)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Range", "bytes=100-149")
	rec := httptest.NewRecorder()
	rec.Header().Set("Content-Type", "audio/webm")
	http.ServeContent(rec, req, "", file.ModTime, file)
	file.Close()
	if rec.Code != http.StatusPartialContent || rec.Body.String() != string(data[100:150]) {
		t.Fatalf("range answered %d %q", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Range"); got != "bytes 100-149/5000" {
		t.Fatalf("Content-Range %q", got)
	}
	if total, temps := onDisk(t, f.cdir); total != 0 || temps != 0 {
		t.Fatalf("a partial read left %d bytes and %d temporary files in the cache", total, temps)
	}

	// Read straight through, the file is cached for the next reader.
	file, err = f.drive.OpenObject(ctx, user, "recordings", id)
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(file)
	file.Close()
	if err != nil || !bytes.Equal(got, data) {
		t.Fatalf("full read: %d bytes, %v", len(got), err)
	}
	opens := f.remote.opens
	file, err = f.drive.OpenObject(ctx, user, "recordings", id)
	if err != nil {
		t.Fatal(err)
	}
	file.Close()
	if f.remote.opens != opens {
		t.Fatal("a file read through was not cached")
	}
}

func TestDriveReadsFollowWhereEachFileIs(t *testing.T) {
	f := newDriveFixture(t)
	ctx, user, id := context.Background(), uuid.New(), uuid.New()
	// Written to the server before the learner chose Drive.
	if err := f.local.PutObject(ctx, user, "exam_papers", id, []byte("an older paper")); err != nil {
		t.Fatal(err)
	}
	digest, err := f.local.PutOriginal(ctx, user, []byte("an older upload"))
	if err != nil {
		t.Fatal(err)
	}
	if got, err := f.drive.GetObject(ctx, user, "exam_papers", id); err != nil || string(got) != "an older paper" {
		t.Fatalf("server object: %q, %v", got, err)
	}
	file, err := f.drive.OpenOriginal(ctx, user, digest)
	if err != nil {
		t.Fatal(err)
	}
	file.Close()
	if f.remote.opens != 0 {
		t.Fatal("a file on the server was looked for in Drive")
	}
	// Written again, it moves to Drive and the server's copy goes.
	if err := f.drive.PutObject(ctx, user, "exam_papers", id, []byte("a newer paper")); err != nil {
		t.Fatal(err)
	}
	if _, err := f.local.GetObject(ctx, user, "exam_papers", id); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("the server's copy outlived the write to Drive: %v", err)
	}
}

func TestDriveRecordsAFileRemovedFromDrive(t *testing.T) {
	f := newDriveFixture(t)
	ctx, user := context.Background(), uuid.New()
	digest, err := f.drive.PutOriginal(ctx, user, []byte("deleted by the learner"))
	if err != nil {
		t.Fatal(err)
	}
	row, _ := f.index.GetDriveFile(ctx, user, blob.KindOriginal, digest)
	f.remote.removed[row.DriveFileID] = true
	f.reopenCache(t, 1<<20)

	_, err = f.drive.OpenOriginal(ctx, user, digest)
	if !errors.Is(err, blob.ErrRemoved) || !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("open: %v", err)
	}
	if row, _ := f.index.GetDriveFile(ctx, user, blob.KindOriginal, digest); row.MissingAt == nil {
		t.Fatal("missing_at was not set")
	}
	// Uploading the same bytes again relinks instead of reusing the gone file.
	if _, err := f.drive.PutOriginal(ctx, user, []byte("deleted by the learner")); err != nil {
		t.Fatal(err)
	}
	if row, _ := f.index.GetDriveFile(ctx, user, blob.KindOriginal, digest); row.MissingAt != nil || f.remote.puts != 2 {
		t.Fatalf("not relinked: %+v after %d uploads", row, f.remote.puts)
	}
}

func TestDriveReplacingAnObjectDeletesTheOldFile(t *testing.T) {
	f := newDriveFixture(t)
	ctx, user, id := context.Background(), uuid.New(), uuid.New()
	_ = f.drive.PutObject(ctx, user, "audio", id, []byte("first"))
	first, _ := f.index.GetDriveFile(ctx, user, "audio", id.String())
	_ = f.drive.PutObject(ctx, user, "audio", id, []byte("second"))
	second, _ := f.index.GetDriveFile(ctx, user, "audio", id.String())
	if first.DriveFileID == second.DriveFileID {
		t.Fatal("the row still names the first file")
	}
	if len(f.remote.deletes) != 1 || f.remote.deletes[0] != first.DriveFileID {
		t.Fatalf("deleted %v, want the first file", f.remote.deletes)
	}
	if got := f.remote.only(t).data; string(got) != "second" {
		t.Fatalf("Drive holds %q", got)
	}

	if err := f.drive.DeleteObject(ctx, user, "audio", id); err != nil {
		t.Fatal(err)
	}
	if _, err := f.index.GetDriveFile(ctx, user, "audio", id.String()); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("row outlived the delete: %v", err)
	}
	if len(f.remote.files) != 0 || f.cache.Size() != 0 {
		t.Fatalf("Drive holds %d files and the cache %d bytes after the delete", len(f.remote.files), f.cache.Size())
	}
}

// Owner decision 1: account deletion deletes no file in the learner's Drive.
// It removes the cache.
func TestDriveDeleteUserRemovesTheCacheAndNothingInDrive(t *testing.T) {
	f := newDriveFixture(t)
	ctx, alice, bob := context.Background(), uuid.New(), uuid.New()
	for _, u := range []uuid.UUID{alice, bob} {
		if _, err := f.drive.PutOriginal(ctx, u, []byte("kept "+u.String())); err != nil {
			t.Fatal(err)
		}
	}
	router := blob.NewRouter(f.local, nil, f.drive)
	if err := router.DeleteUser(ctx, alice); err != nil {
		t.Fatal(err)
	}
	if len(f.remote.deletes) != 0 || len(f.remote.files) != 2 {
		t.Fatalf("account deletion touched Drive: %d deletes, %d files left", len(f.remote.deletes), len(f.remote.files))
	}
	if _, err := os.Stat(filepath.Join(f.cdir, alice.String())); !os.IsNotExist(err) {
		t.Fatalf("alice's cache outlived her account: %v", err)
	}
	if _, err := os.Stat(filepath.Join(f.cdir, bob.String())); err != nil {
		t.Fatalf("bob's cache went with alice's: %v", err)
	}
}

func TestDriveRefusesWhatLocalRefuses(t *testing.T) {
	f := newDriveFixture(t)
	ctx, user := context.Background(), uuid.New()
	if err := f.drive.PutObject(ctx, user, "../x", uuid.New(), []byte("x")); err == nil {
		t.Fatal("a bad namespace was accepted")
	}
	if _, err := f.drive.GetOriginal(ctx, user, "../../etc/passwd"); err == nil {
		t.Fatal("a bad digest was accepted")
	}
	if f.remote.puts != 0 || f.remote.opens != 0 {
		t.Fatal("a refused name reached Drive")
	}
}

func TestFileNamesAreReadable(t *testing.T) {
	at := time.Date(2026, 1, 2, 3, 4, 0, 0, time.UTC)
	for _, c := range []struct{ title, kind, mime, want string }{
		{"Chemistry notes", blob.KindOriginal, "application/pdf", "Chemistry notes.pdf"},
		{"report.PDF", blob.KindOriginal, "application/pdf", "report.PDF"},
		{"", "audio", "audio/wave", "Audio overview 2026-01-02 03.04.wav"},
		{"a/b\x00c", "recordings", "audio/webm", "a-bc.webm"},
		{"", "unknown", "application/octet-stream", "File 2026-01-02 03.04"},
	} {
		got := blob.FileName(c.title, c.kind, c.mime, at)
		if c.want == "File 2026-01-02 03.04" {
			if !strings.HasPrefix(got, c.want) {
				t.Errorf("%q: %q", c.title, got)
			}
			continue
		}
		if got != c.want {
			t.Errorf("FileName(%q, %s, %s) = %q, want %q", c.title, c.kind, c.mime, got, c.want)
		}
	}
}
