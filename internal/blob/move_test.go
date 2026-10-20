package blob_test

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
)

// move_test.go — moving a learner's files between the server and their
// Drive (drive-user-storage phase 2), against the in-memory Drive and index
// of drive_test.go. Each interrupted step is reproduced by leaving the state
// that step would have left, then running the unit again.

// movingRemote adds what a move needs to fakeRemote: Find by appProperties
// and Stat with Drive's own checksums.
type movingRemote struct {
	*fakeRemote
	badSHA bool // Stat reports another sha256 than the stored bytes'
	noSHA  bool // Stat reports no sha256, as Drive may
}

func (r *movingRemote) describe(id string, f *remoteFile) blob.RemoteCopy {
	m := md5.Sum(f.data)
	c := blob.RemoteCopy{ID: id, Size: int64(len(f.data)), MD5: hex.EncodeToString(m[:]),
		SHA256: blob.Digest(f.data), PropSHA256: f.up.SHA256}
	if r.badSHA {
		c.SHA256 = strings.Repeat("0", 64)
	}
	if r.noSHA {
		c.SHA256 = ""
	}
	return c
}

func (r *movingRemote) Find(_ context.Context, u uuid.UUID, kind, key string) ([]blob.RemoteCopy, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var ids []string
	for id, f := range r.files {
		if r.owner[id] == u && f.up.Kind == kind && f.up.Key == key && !r.removed[id] {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	out := make([]blob.RemoteCopy, 0, len(ids))
	for _, id := range ids {
		out = append(out, r.describe(id, r.files[id]))
	}
	return out, nil
}

func (r *movingRemote) Stat(_ context.Context, u uuid.UUID, id string) (blob.RemoteCopy, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	f, ok := r.files[id]
	if !ok || r.owner[id] != u || r.removed[id] {
		return blob.RemoteCopy{}, blob.ErrRemoved
	}
	return r.describe(id, f), nil
}

func (r *movingRemote) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.files)
}

func (r *movingRemote) putCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.puts
}

// movingIndex adds the conditional writes a move uses to fakeIndex.
type movingIndex struct{ *fakeIndex }

func (x movingIndex) ListDriveFiles(_ context.Context, u uuid.UUID) ([]blob.DriveFile, error) {
	x.mu.Lock()
	defer x.mu.Unlock()
	var out []blob.DriveFile
	for k, f := range x.rows {
		if k.user == u {
			out = append(out, f)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Kind+out[i].Key < out[j].Kind+out[j].Key })
	return out, nil
}

func (x movingIndex) InsertDriveFile(ctx context.Context, f blob.DriveFile) (bool, error) {
	x.mu.Lock()
	_, exists := x.rows[indexKey{f.UserID, f.Kind, f.Key}]
	x.mu.Unlock()
	if exists {
		return false, nil
	}
	return true, x.PutDriveFile(ctx, f)
}

func (x movingIndex) DeleteDriveFileIf(_ context.Context, u uuid.UUID, kind, key, fileID string) (bool, error) {
	x.mu.Lock()
	defer x.mu.Unlock()
	k := indexKey{u, kind, key}
	if f, ok := x.rows[k]; ok && f.DriveFileID == fileID {
		delete(x.rows, k)
		return true, nil
	}
	return false, nil
}

func (x movingIndex) count(u uuid.UUID) int {
	rows, _ := x.ListDriveFiles(context.Background(), u)
	return len(rows)
}

type moveFixture struct {
	local  *blob.Local
	root   string
	remote *movingRemote
	index  movingIndex
	drive  *blob.Drive
	user   uuid.UUID
	// choice is the learner's setting, as the router reads it.
	choice string
	router *blob.Router
	// bucket, when set, holds the server's copies instead of root.
	bucket *memBucket
}

func newMoveFixture(t *testing.T) *moveFixture {
	t.Helper()
	local, root := newStore(t)
	return newMoveFixtureOn(t, local, root, nil)
}

func newMoveFixtureOn(t *testing.T, local *blob.Local, root string, bucket *memBucket) *moveFixture {
	t.Helper()
	f := &moveFixture{local: local, root: root, bucket: bucket, remote: &movingRemote{fakeRemote: newFakeRemote()},
		index: movingIndex{newFakeIndex()}, user: uuid.New(), choice: blob.StorageServer}
	cache, err := blob.NewCache(t.TempDir(), 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	f.drive, err = blob.NewDrive(blob.DriveConfig{Local: local, Remote: f.remote, Index: f.index, Cache: cache,
		Now: func() time.Time { return time.Date(2026, 10, 17, 20, 0, 0, 0, time.UTC) }})
	if err != nil {
		t.Fatal(err)
	}
	f.router = blob.NewRouter(local, blob.StorageChoice(local, f.drive, func(context.Context, uuid.UUID) (string, error) {
		return f.choice, nil
	}), f.drive)
	return f
}

// seedServer writes an original and a recording to the server's disk, as a
// learner who never chose Drive would have them.
func (f *moveFixture) seedServer(t *testing.T) (digest string, rec uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	digest, err := f.local.PutOriginal(ctx, f.user, []byte("%PDF-1.7 chapter one"))
	if err != nil {
		t.Fatal(err)
	}
	rec = uuid.New()
	if err := f.local.PutObject(ctx, f.user, "recordings", rec, []byte("OggS a spoken answer")); err != nil {
		t.Fatal(err)
	}
	// Derived files are not the learner's to move.
	if err := f.local.PutObject(ctx, f.user, "transcripts", uuid.New(), []byte("derived")); err != nil {
		t.Fatal(err)
	}
	if _, err := f.local.PutParsed(ctx, f.user, uuid.New(), 1, "# parsed"); err != nil {
		t.Fatal(err)
	}
	return digest, rec
}

func (f *moveFixture) plan(t *testing.T, dir blob.MoveDirection) []blob.MoveItem {
	t.Helper()
	items, err := f.drive.PlanMove(context.Background(), f.user, dir)
	if err != nil {
		t.Fatal(err)
	}
	return items
}

func (f *moveFixture) moveAll(t *testing.T, dir blob.MoveDirection, items []blob.MoveItem) {
	t.Helper()
	for _, it := range items {
		moved, err := f.drive.MoveOne(context.Background(), f.user, dir, it)
		if err != nil || !moved {
			t.Fatalf("MoveOne(%s %s) = %v, %v", it.Kind, it.Key, moved, err)
		}
	}
}

func (f *moveFixture) onServer(kind, key string) bool {
	rel := filepath.Join("objects", f.user.String(), kind, key)
	if kind == blob.KindOriginal {
		rel = filepath.Join("originals", f.user.String(), key[:2], key)
	}
	if f.bucket != nil {
		return f.bucket.has(filepath.ToSlash(rel))
	}
	_, err := os.Stat(filepath.Join(f.root, rel))
	return err == nil
}

func TestMovePlansOnlyTheLearnersOwnFiles(t *testing.T) {
	f := newMoveFixture(t)
	digest, rec := f.seedServer(t)
	items := f.plan(t, blob.MoveToDrive)
	if len(items) != 2 {
		t.Fatalf("planned %+v, want the original and the recording", items)
	}
	got := map[string]int64{}
	for _, it := range items {
		got[it.Kind+"/"+it.Key] = it.Bytes
	}
	if got["original/"+digest] != int64(len("%PDF-1.7 chapter one")) || got["recordings/"+rec.String()] != int64(len("OggS a spoken answer")) {
		t.Fatalf("planned %+v", items)
	}
	// Another learner's files are never in the plan.
	other, err := f.drive.PlanMove(context.Background(), uuid.New(), blob.MoveToDrive)
	if err != nil || len(other) != 0 {
		t.Fatalf("another learner's plan = %+v, %v", other, err)
	}
}

func TestMoveToDriveAndBack(t *testing.T) {
	f := newMoveFixture(t)
	ctx := context.Background()
	digest, rec := f.seedServer(t)

	f.choice = blob.StorageDrive
	f.moveAll(t, blob.MoveToDrive, f.plan(t, blob.MoveToDrive))
	if f.onServer(blob.KindOriginal, digest) || f.onServer("recordings", rec.String()) {
		t.Fatal("a server copy is still there after its move to Drive")
	}
	if f.remote.count() != 2 || f.index.count(f.user) != 2 {
		t.Fatalf("Drive holds %d files and %d rows, want 2 and 2", f.remote.count(), f.index.count(f.user))
	}
	if data, err := f.router.GetOriginal(ctx, f.user, digest); err != nil || string(data) != "%PDF-1.7 chapter one" {
		t.Fatalf("read after the move = %q, %v", data, err)
	}
	if data, err := f.router.GetObject(ctx, f.user, "recordings", rec); err != nil || string(data) != "OggS a spoken answer" {
		t.Fatalf("read after the move = %q, %v", data, err)
	}

	f.choice = blob.StorageServer
	back := f.plan(t, blob.MoveToServer)
	if len(back) != 2 {
		t.Fatalf("planned back %+v", back)
	}
	f.moveAll(t, blob.MoveToServer, back)
	if !f.onServer(blob.KindOriginal, digest) || !f.onServer("recordings", rec.String()) {
		t.Fatal("a file did not arrive on the server")
	}
	if f.remote.count() != 0 || f.index.count(f.user) != 0 {
		t.Fatalf("Drive still holds %d files and %d rows after the move back", f.remote.count(), f.index.count(f.user))
	}
	if data, err := f.router.GetOriginal(ctx, f.user, digest); err != nil || string(data) != "%PDF-1.7 chapter one" {
		t.Fatalf("read after the move back = %q, %v", data, err)
	}
}

// An upload that finished but was never recorded (the process stopped
// between the two) is found again by its appProperties, not uploaded twice.
func TestMoveToDriveResumesAnUploadThatWasNeverRecorded(t *testing.T) {
	f := newMoveFixture(t)
	ctx := context.Background()
	digest, _ := f.seedServer(t)
	data := []byte("%PDF-1.7 chapter one")
	if _, err := f.remote.Put(ctx, f.user, blob.RemoteUpload{Folder: blob.FolderUploads, Name: "Upload.pdf",
		Kind: blob.KindOriginal, Key: digest, SHA256: digest, Size: int64(len(data)), Body: bytes.NewReader(data)}); err != nil {
		t.Fatal(err)
	}
	puts := f.remote.putCount()

	moved, err := f.drive.MoveOne(ctx, f.user, blob.MoveToDrive, blob.MoveItem{Kind: blob.KindOriginal, Key: digest})
	if err != nil || !moved {
		t.Fatalf("MoveOne = %v, %v", moved, err)
	}
	if f.remote.putCount() != puts {
		t.Fatal("the resumed unit uploaded the file a second time")
	}
	if f.remote.count() != 1 {
		t.Fatalf("Drive holds %d copies, want 1", f.remote.count())
	}
	row, err := f.index.GetDriveFile(ctx, f.user, blob.KindOriginal, digest)
	if err != nil || row.SHA256 != digest {
		t.Fatalf("row = %+v, %v", row, err)
	}
	if f.onServer(blob.KindOriginal, digest) {
		t.Fatal("the server copy was kept after the move was recorded")
	}
}

// Recorded in Drive, but the server copy not yet deleted: the rerun only
// deletes it.
func TestMoveToDriveResumesAfterTheRecord(t *testing.T) {
	f := newMoveFixture(t)
	ctx := context.Background()
	_, rec := f.seedServer(t)
	it := blob.MoveItem{Kind: "recordings", Key: rec.String()}
	if _, err := f.drive.MoveOne(ctx, f.user, blob.MoveToDrive, it); err != nil {
		t.Fatal(err)
	}
	// Put the server copy back, as if the delete never ran.
	if err := f.local.PutObject(ctx, f.user, "recordings", rec, []byte("OggS a spoken answer")); err != nil {
		t.Fatal(err)
	}
	puts := f.remote.putCount()
	if moved, err := f.drive.MoveOne(ctx, f.user, blob.MoveToDrive, it); err != nil || !moved {
		t.Fatalf("rerun = %v, %v", moved, err)
	}
	if f.remote.putCount() != puts || f.remote.count() != 1 || f.onServer("recordings", rec.String()) {
		t.Fatal("the rerun did more than delete the server copy")
	}
}

// Written to the server but not recorded: the rerun copies it again and
// finishes.
func TestMoveToServerResumesAWriteThatWasNeverRecorded(t *testing.T) {
	f := newMoveFixture(t)
	ctx := context.Background()
	_, rec := f.seedServer(t)
	f.moveAll(t, blob.MoveToDrive, f.plan(t, blob.MoveToDrive))
	// The server copy is there again, the row still says Drive.
	if err := f.local.PutObject(ctx, f.user, "recordings", rec, []byte("OggS a spoken answer")); err != nil {
		t.Fatal(err)
	}
	if moved, err := f.drive.MoveOne(ctx, f.user, blob.MoveToServer, blob.MoveItem{Kind: "recordings", Key: rec.String()}); err != nil || !moved {
		t.Fatalf("MoveOne = %v, %v", moved, err)
	}
	if _, err := f.index.GetDriveFile(ctx, f.user, "recordings", rec.String()); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("the row is still there: %v", err)
	}
	if f.remote.count() != 1 { // the original is still in Drive; the recording is not
		t.Fatalf("Drive holds %d files, want 1", f.remote.count())
	}
	if data, err := f.local.GetObject(ctx, f.user, "recordings", rec); err != nil || string(data) != "OggS a spoken answer" {
		t.Fatalf("server copy = %q, %v", data, err)
	}
}

// Recorded on the server, but the Drive copy not yet deleted: the rerun finds
// it by its appProperties and deletes it, because its sha256 matches.
func TestMoveToServerResumesAfterTheRecord(t *testing.T) {
	f := newMoveFixture(t)
	ctx := context.Background()
	digest, _ := f.seedServer(t)
	it := blob.MoveItem{Kind: blob.KindOriginal, Key: digest}
	if _, err := f.drive.MoveOne(ctx, f.user, blob.MoveToDrive, it); err != nil {
		t.Fatal(err)
	}
	// The state a stopped unit leaves: the server copy written, the row
	// gone, the Drive copy still there.
	if _, err := f.local.PutOriginal(ctx, f.user, []byte("%PDF-1.7 chapter one")); err != nil {
		t.Fatal(err)
	}
	if err := f.index.DeleteDriveFile(ctx, f.user, blob.KindOriginal, digest); err != nil {
		t.Fatal(err)
	}
	if moved, err := f.drive.MoveOne(ctx, f.user, blob.MoveToServer, it); err != nil || !moved {
		t.Fatalf("rerun = %v, %v", moved, err)
	}
	if f.remote.count() != 0 {
		t.Fatalf("Drive still holds %d copies", f.remote.count())
	}
	if !f.onServer(blob.KindOriginal, digest) {
		t.Fatal("the server copy went too")
	}
}

// The old copy goes only after the new one's checksum matches. A Drive copy
// whose sha256 is not the server's is removed again, and the server copy
// stays, unrecorded.
func TestMoveToDriveKeepsTheServerCopyWhenDrivesChecksumDiffers(t *testing.T) {
	f := newMoveFixture(t)
	ctx := context.Background()
	_, rec := f.seedServer(t)
	f.remote.badSHA = true
	moved, err := f.drive.MoveOne(ctx, f.user, blob.MoveToDrive, blob.MoveItem{Kind: "recordings", Key: rec.String()})
	if err != nil || moved {
		t.Fatalf("MoveOne = %v, %v; want left where it is", moved, err)
	}
	if !f.onServer("recordings", rec.String()) {
		t.Fatal("the server copy was deleted although Drive's copy did not match")
	}
	if _, err := f.index.GetDriveFile(ctx, f.user, "recordings", rec.String()); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("a copy that did not match was recorded: %v", err)
	}
	if f.remote.count() != 0 {
		t.Fatal("the copy that did not match was left in Drive")
	}
}

// Without a sha256 from Drive, its md5Checksum is checked instead.
func TestMoveToDriveChecksMD5WhenDriveGivesNoSHA256(t *testing.T) {
	f := newMoveFixture(t)
	_, rec := f.seedServer(t)
	f.remote.noSHA = true
	if moved, err := f.drive.MoveOne(context.Background(), f.user, blob.MoveToDrive, blob.MoveItem{Kind: "recordings", Key: rec.String()}); err != nil || !moved {
		t.Fatalf("MoveOne = %v, %v", moved, err)
	}
}

// A Drive copy that reads back as other bytes is not written to the server,
// and stays in Drive with its row.
func TestMoveToServerKeepsTheDriveCopyWhenItDoesNotMatch(t *testing.T) {
	f := newMoveFixture(t)
	ctx := context.Background()
	_, rec := f.seedServer(t)
	f.moveAll(t, blob.MoveToDrive, f.plan(t, blob.MoveToDrive))
	f.remote.corrupt = true
	moved, err := f.drive.MoveOne(ctx, f.user, blob.MoveToServer, blob.MoveItem{Kind: "recordings", Key: rec.String()})
	if err != nil || moved {
		t.Fatalf("MoveOne = %v, %v; want left where it is", moved, err)
	}
	if f.onServer("recordings", rec.String()) {
		t.Fatal("bytes that did not match were written to the server")
	}
	if _, err := f.index.GetDriveFile(ctx, f.user, "recordings", rec.String()); err != nil {
		t.Fatalf("the row went: %v", err)
	}
	if f.remote.count() != 2 {
		t.Fatal("the Drive copy was deleted although nothing matched it on the server")
	}
}

// Part way through a move, in either direction, every file reads.
func TestReadsDuringAMoveFindEveryFile(t *testing.T) {
	f := newMoveFixture(t)
	ctx := context.Background()
	var keys []uuid.UUID
	for i := 0; i < 4; i++ {
		id := uuid.New()
		keys = append(keys, id)
		if err := f.local.PutObject(ctx, f.user, "recordings", id, []byte("rec "+id.String())); err != nil {
			t.Fatal(err)
		}
	}
	readAll := func(when string) {
		t.Helper()
		for _, id := range keys {
			data, err := f.router.GetObject(ctx, f.user, "recordings", id)
			if err != nil || string(data) != "rec "+id.String() {
				t.Fatalf("%s: %s = %q, %v", when, id, data, err)
			}
			file, err := f.router.OpenObject(ctx, f.user, "recordings", id)
			if err != nil {
				t.Fatalf("%s: open %s: %v", when, id, err)
			}
			file.Close()
		}
	}

	f.choice = blob.StorageDrive
	items := f.plan(t, blob.MoveToDrive)
	f.moveAll(t, blob.MoveToDrive, items[:2])
	readAll("half way to Drive")

	f.choice = blob.StorageServer
	f.moveAll(t, blob.MoveToDrive, items[2:3])
	back := f.plan(t, blob.MoveToServer)
	f.moveAll(t, blob.MoveToServer, back[:1])
	readAll("half way back")
}

// New writes go where the learner chose; a learner on the server who writes
// an object again forgets its older copy in Drive.
func TestWritesGoWhereTheLearnerChose(t *testing.T) {
	f := newMoveFixture(t)
	ctx := context.Background()
	id := uuid.New()

	f.choice = blob.StorageDrive
	if err := f.router.PutObject(ctx, f.user, "recordings", id, []byte("in Drive")); err != nil {
		t.Fatal(err)
	}
	if f.remote.count() != 1 || f.onServer("recordings", id.String()) {
		t.Fatal("a Drive learner's write did not go to Drive")
	}

	f.choice = blob.StorageServer
	if err := f.router.PutObject(ctx, f.user, "recordings", id, []byte("on the server")); err != nil {
		t.Fatal(err)
	}
	if !f.onServer("recordings", id.String()) || f.remote.count() != 0 || f.index.count(f.user) != 0 {
		t.Fatal("a server learner's write left the older copy recorded in Drive")
	}
	if data, err := f.router.GetObject(ctx, f.user, "recordings", id); err != nil || string(data) != "on the server" {
		t.Fatalf("read = %q, %v", data, err)
	}

	// An original already in Drive is the same bytes: not stored twice.
	f.choice = blob.StorageDrive
	digest, err := f.router.PutOriginal(ctx, f.user, []byte("%PDF same"))
	if err != nil {
		t.Fatal(err)
	}
	f.choice = blob.StorageServer
	if _, err := f.router.PutOriginal(ctx, f.user, []byte("%PDF same")); err != nil {
		t.Fatal(err)
	}
	if f.onServer(blob.KindOriginal, digest) {
		t.Fatal("an original already in Drive was stored on the server too")
	}
}

// Drive storage that is not configured keeps everyone on the server.
func TestStorageChoiceWithoutDriveIsTheServer(t *testing.T) {
	local, _ := newStore(t)
	choose := blob.StorageChoice(local, nil, func(context.Context, uuid.UUID) (string, error) {
		t.Fatal("the setting was read with no Drive backend")
		return "", nil
	})
	b, err := choose(context.Background(), uuid.New())
	if err != nil || b != blob.Backend(local) {
		t.Fatalf("backend = %v, %v", b, err)
	}
}

func TestSaveExportWritesIntoExports(t *testing.T) {
	f := newMoveFixture(t)
	id, err := f.drive.SaveExport(context.Background(), f.user, "worksheet:x", "Week 3.md", "text/markdown", []byte("# Week 3"))
	if err != nil || id == "" {
		t.Fatalf("SaveExport = %q, %v", id, err)
	}
	got := f.remote.only(t)
	if got.up.Folder != blob.FolderExports || got.up.Name != "Week 3.md" || string(got.data) != "# Week 3" {
		t.Fatalf("export written as %+v", got.up)
	}
	if f.index.count(f.user) != 0 {
		t.Fatal("an export was recorded as a file AnyTools reads back")
	}
}
