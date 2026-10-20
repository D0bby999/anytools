package blob_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
)

// memBucket is blob.Bucket in memory. gets counts reads, by offset.
type memBucket struct {
	mu   sync.Mutex
	objs map[string][]byte
	gets []int64
}

func newMemBucket() *memBucket { return &memBucket{objs: map[string][]byte{}} }

func (b *memBucket) Put(_ context.Context, key string, body io.ReadSeeker, size int64) error {
	data, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	if int64(len(data)) != size {
		return errors.New("memBucket: size does not match the body")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.objs[key] = data
	return nil
}

func (b *memBucket) Get(_ context.Context, key string, offset int64) (io.ReadCloser, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	data, ok := b.objs[key]
	if !ok {
		return nil, blob.ErrNotFound
	}
	b.gets = append(b.gets, offset)
	return io.NopCloser(bytes.NewReader(data[min(offset, int64(len(data))):])), nil
}

func (b *memBucket) Stat(_ context.Context, key string) (blob.BucketObject, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	data, ok := b.objs[key]
	if !ok {
		return blob.BucketObject{}, blob.ErrNotFound
	}
	return blob.BucketObject{Key: key, Size: int64(len(data)), ModTime: time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)}, nil
}

func (b *memBucket) Delete(_ context.Context, keys ...string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, k := range keys {
		delete(b.objs, k)
	}
	return nil
}

func (b *memBucket) List(_ context.Context, prefix string) ([]blob.BucketObject, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	var out []blob.BucketObject
	for k, v := range b.objs {
		if strings.HasPrefix(k, prefix) {
			out = append(out, blob.BucketObject{Key: k, Size: int64(len(v))})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out, nil
}

func (b *memBucket) has(key string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	_, ok := b.objs[key]
	return ok
}

func (b *memBucket) keys() []string {
	objs, _ := b.List(context.Background(), "")
	out := make([]string, len(objs))
	for i, o := range objs {
		out[i] = o.Key
	}
	return out
}

func newBucketStore(t *testing.T) (*blob.Local, string, *memBucket) {
	t.Helper()
	dir := t.TempDir()
	b := newMemBucket()
	l, err := blob.NewLocalWithBucket(dir, b)
	if err != nil {
		t.Fatal(err)
	}
	return l, dir, b
}

// filesUnder lists the regular files below root/sub, relative to root.
func filesUnder(t *testing.T, root, sub string) []string {
	t.Helper()
	var out []string
	filepath.WalkDir(filepath.Join(root, sub), func(p string, d os.DirEntry, err error) error {
		if err == nil && d.Type().IsRegular() {
			rel, _ := filepath.Rel(root, p)
			out = append(out, filepath.ToSlash(rel))
		}
		return nil
	})
	return out
}

func TestABucketHoldsOriginalsAndObjectsAndTheDiskTheRest(t *testing.T) {
	l, dir, b := newBucketStore(t)
	ctx := context.Background()
	user, doc, rec := uuid.New(), uuid.New(), uuid.New()

	digest, err := l.PutOriginal(ctx, user, []byte("%PDF-1.7 a chapter"))
	if err != nil {
		t.Fatal(err)
	}
	if err := l.PutObject(ctx, user, "recordings", rec, []byte("OggS an answer")); err != nil {
		t.Fatal(err)
	}
	parsed, err := l.PutParsed(ctx, user, doc, 1, "# A chapter")
	if err != nil {
		t.Fatal(err)
	}

	want := []string{
		"objects/" + user.String() + "/recordings/" + rec.String(),
		"originals/" + user.String() + "/" + digest[:2] + "/" + digest,
	}
	if got := b.keys(); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("bucket keys = %v, want %v", got, want)
	}
	if got := filesUnder(t, dir, "originals"); len(got) != 0 {
		t.Fatalf("an original is on the disk too: %v", got)
	}
	if got := filesUnder(t, dir, "objects"); len(got) != 0 {
		t.Fatalf("an object is on the disk too: %v", got)
	}
	// Parsed Markdown is read on every search: it stays on the disk.
	if md, err := l.GetParsed(ctx, parsed); err != nil || md != "# A chapter" {
		t.Fatalf("GetParsed = %q, %v", md, err)
	}
	if data, err := l.GetOriginal(ctx, user, digest); err != nil || string(data) != "%PDF-1.7 a chapter" {
		t.Fatalf("GetOriginal = %q, %v", data, err)
	}
	if data, err := l.GetObject(ctx, user, "recordings", rec); err != nil || string(data) != "OggS an answer" {
		t.Fatalf("GetObject = %q, %v", data, err)
	}
	if _, err := l.GetObject(ctx, user, "recordings", uuid.New()); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("a missing object = %v, want ErrNotFound", err)
	}
}

// A player seeks: ServeContent answers a range request by seeking the File,
// and only the bytes from there on are fetched.
func TestABucketFileAnswersRangeRequests(t *testing.T) {
	l, _, b := newBucketStore(t)
	ctx := context.Background()
	user, id := uuid.New(), uuid.New()
	audio := bytes.Repeat([]byte("0123456789"), 1000)
	if err := l.PutObject(ctx, user, "audio", id, audio); err != nil {
		t.Fatal(err)
	}

	f, err := l.OpenObject(ctx, user, "audio", id)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if f.Size != int64(len(audio)) {
		t.Fatalf("Size = %d, want %d", f.Size, len(audio))
	}
	req := httptest.NewRequest(http.MethodGet, "/a", nil)
	req.Header.Set("Range", "bytes=5000-5009")
	rr := httptest.NewRecorder()
	http.ServeContent(rr, req, "a.mp3", f.ModTime, f)
	if rr.Code != http.StatusPartialContent || rr.Body.String() != string(audio[5000:5010]) {
		t.Fatalf("range = %d %q", rr.Code, rr.Body.String())
	}
	b.mu.Lock()
	gets := append([]int64(nil), b.gets...)
	b.mu.Unlock()
	if len(gets) == 0 || gets[len(gets)-1] != 5000 {
		t.Fatalf("reads by offset = %v, want the last at 5000", gets)
	}
}

// A server that starts using a bucket keeps the files it already has: they
// are read from the disk until written again, and deleted from both.
func TestFilesFromBeforeTheBucketAreStillThere(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()
	user, rec := uuid.New(), uuid.New()
	disk, err := blob.NewLocal(dir)
	if err != nil {
		t.Fatal(err)
	}
	digest, err := disk.PutOriginal(ctx, user, []byte("old upload"))
	if err != nil {
		t.Fatal(err)
	}
	if err := disk.PutObject(ctx, user, "recordings", rec, []byte("old recording")); err != nil {
		t.Fatal(err)
	}

	b := newMemBucket()
	l, err := blob.NewLocalWithBucket(dir, b)
	if err != nil {
		t.Fatal(err)
	}
	if data, err := l.GetOriginal(ctx, user, digest); err != nil || string(data) != "old upload" {
		t.Fatalf("GetOriginal = %q, %v", data, err)
	}
	f, err := l.OpenObject(ctx, user, "recordings", rec)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(f)
	f.Close()
	if string(data) != "old recording" {
		t.Fatalf("OpenObject read %q", data)
	}

	// Written again: the bucket's copy is the file, the disk's is gone.
	if err := l.PutObject(ctx, user, "recordings", rec, []byte("new recording")); err != nil {
		t.Fatal(err)
	}
	if got := filesUnder(t, dir, "objects"); len(got) != 0 {
		t.Fatalf("the replaced disk copy is still there: %v", got)
	}
	if err := l.DeleteOriginal(ctx, user, digest); err != nil {
		t.Fatal(err)
	}
	if got := filesUnder(t, dir, "originals"); len(got) != 0 {
		t.Fatalf("DeleteOriginal left %v on the disk", got)
	}
}

func TestWriteObjectToABucketIsWholeOrNothing(t *testing.T) {
	l, dir, b := newBucketStore(t)
	ctx := context.Background()
	user, ok, bad := uuid.New(), uuid.New(), uuid.New()

	if err := l.WriteObject(ctx, user, "audio", ok, func(w io.Writer) error {
		_, err := io.WriteString(w, "a whole overview")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if data, err := l.GetObject(ctx, user, "audio", ok); err != nil || string(data) != "a whole overview" {
		t.Fatalf("GetObject = %q, %v", data, err)
	}
	boom := errors.New("the encoder stopped")
	if err := l.WriteObject(ctx, user, "audio", bad, func(w io.Writer) error {
		io.WriteString(w, "half")
		return boom
	}); !errors.Is(err, boom) {
		t.Fatalf("WriteObject = %v, want the writer's error", err)
	}
	if b.has("objects/" + user.String() + "/audio/" + bad.String()) {
		t.Fatal("a failed write reached the bucket")
	}
	if got := filesUnder(t, dir, "tmp"); len(got) != 0 {
		t.Fatalf("scratch files left behind: %v", got)
	}
}

func TestDeleteUserEmptiesTheirKeysOnly(t *testing.T) {
	l, _, b := newBucketStore(t)
	ctx := context.Background()
	gone, kept := uuid.New(), uuid.New()
	for _, u := range []uuid.UUID{gone, kept} {
		if _, err := l.PutOriginal(ctx, u, []byte("pdf of "+u.String())); err != nil {
			t.Fatal(err)
		}
		if err := l.PutObject(ctx, u, "recordings", uuid.New(), []byte("rec")); err != nil {
			t.Fatal(err)
		}
	}
	if err := l.DeleteUser(ctx, gone); err != nil {
		t.Fatal(err)
	}
	for _, k := range b.keys() {
		if strings.Contains(k, gone.String()) {
			t.Fatalf("%s survived the account's deletion", k)
		}
	}
	if len(b.keys()) != 2 {
		t.Fatalf("the other learner's keys = %v, want 2", b.keys())
	}
}

func TestMoveToDriveAndBackWithABucket(t *testing.T) {
	local, root, b := newBucketStore(t)
	f := newMoveFixtureOn(t, local, root, b)
	ctx := context.Background()
	digest, rec := f.seedServer(t)

	items := f.plan(t, blob.MoveToDrive)
	if len(items) != 2 {
		t.Fatalf("planned %+v, want the original and the recording from the bucket", items)
	}
	f.choice = blob.StorageDrive
	f.moveAll(t, blob.MoveToDrive, items)
	if f.onServer(blob.KindOriginal, digest) || f.onServer("recordings", rec.String()) {
		t.Fatal("a bucket copy is still there after its move to Drive")
	}
	if f.remote.count() != 2 {
		t.Fatalf("Drive holds %d files, want 2", f.remote.count())
	}

	f.choice = blob.StorageServer
	f.moveAll(t, blob.MoveToServer, f.plan(t, blob.MoveToServer))
	if !f.onServer(blob.KindOriginal, digest) || !f.onServer("recordings", rec.String()) {
		t.Fatal("a file did not arrive in the bucket")
	}
	if data, err := f.router.GetOriginal(ctx, f.user, digest); err != nil || string(data) != "%PDF-1.7 chapter one" {
		t.Fatalf("read after the move back = %q, %v", data, err)
	}
	if got := filesUnder(t, root, "originals"); len(got) != 0 {
		t.Fatalf("the move back wrote to the disk: %v", got)
	}
	if got := filesUnder(t, root, "tmp"); len(got) != 0 {
		t.Fatalf("scratch files left behind: %v", got)
	}
}
