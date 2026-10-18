package drive

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/connectors/drive/drivetest"
	"github.com/D0bby999/anytools/internal/security"
)

// storage_test.go — Storage against drivetest, a stateful fake of Drive v3
// whose answers are the fixtures in drivetest/testdata, shaped from Google's
// documentation. No Google credentials exist for this project, so no live
// run has been possible.

const storageRefresh = "1//storage-refresh-SECRET"

type storageFixture struct {
	drive   *drivetest.Server
	store   *memStore
	folders *memFolders
	storage *Storage
	user    uuid.UUID
}

func newStorageFixture(t *testing.T) *storageFixture {
	t.Helper()
	fd := drivetest.New(t)
	store := newMemStore()
	user := uuid.New()
	future := time.Now().Add(time.Hour)
	store.conns[user] = &Connection{UserID: user, Scope: ScopeDriveFile,
		RefreshToken: storageRefresh, AccessToken: drivetest.AccessToken, ExpiresAt: &future}
	svc := NewService(Config{Store: store, OAuth: OAuthConfig{
		ClientID: "id.apps.googleusercontent.com", ClientSecret: "secret",
	}})
	folders := newMemFolders()
	st := NewStorage(svc, StorageConfig{
		Folders:   folders,
		HTTP:      security.AllowlistClientOver(fd.Client(), fd.Host()),
		BaseURL:   fd.DriveBase(),
		UploadURL: fd.UploadBase(),
		ChunkSize: chunkUnit,
		Backoff:   func(int) time.Duration { return 0 },
	})
	return &storageFixture{drive: fd, store: store, folders: folders, storage: st, user: user}
}

// memFolders is drive_folders, per user.
type memFolders struct {
	mu   sync.Mutex
	rows map[uuid.UUID]map[string]string
}

func newMemFolders() *memFolders { return &memFolders{rows: map[uuid.UUID]map[string]string{}} }

func (m *memFolders) ListFolders(_ context.Context, u uuid.UUID) (map[string]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]string{}
	for k, v := range m.rows[u] {
		out[k] = v
	}
	return out, nil
}

func (m *memFolders) SaveFolder(_ context.Context, u uuid.UUID, role, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rows[u] == nil {
		m.rows[u] = map[string]string{}
	}
	m.rows[u][role] = id
	return nil
}

func (m *memFolders) ForgetFolders(_ context.Context, u uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.rows, u)
	return nil
}

// payload is deterministic, and spans three 256 KiB chunks.
func payload() []byte {
	b := make([]byte, 2*chunkUnit+12345)
	for i := range b {
		b[i] = byte(i*7 + i/1000)
	}
	return b
}

func uploadOf(data []byte) blob.RemoteUpload {
	return blob.RemoteUpload{
		Folder: blob.FolderRecordings, Name: "Speaking: my week.webm", MIME: "audio/webm",
		Kind: "recordings", Key: uuid.NewString(), SHA256: blob.Digest(data),
		Size: int64(len(data)), Body: bytes.NewReader(data),
	}
}

func TestStorageCreatesTheFoldersOnceAndFindsThemAgain(t *testing.T) {
	f := newStorageFixture(t)
	ctx := context.Background()
	first, err := f.storage.EnsureFolders(ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	if st := f.drive.Stats(); len(first) != len(blob.FolderRoles) || st.Creates != len(blob.FolderRoles) {
		t.Fatalf("%d folders recorded after %d creates", len(first), st.Creates)
	}
	for _, role := range blob.FolderRoles[1:] {
		if gotRole, parent, _ := f.drive.Folder(first[role]); gotRole != role || parent != first[blob.FolderRoot] {
			t.Errorf("%s is %q inside %q, not the AnyTools folder", role, gotRole, parent)
		}
	}

	// Recorded: no request at all.
	lists := f.drive.Stats().Lists
	if _, err := f.storage.EnsureFolders(ctx, f.user); err != nil {
		t.Fatal(err)
	}
	if st := f.drive.Stats(); st.Lists != lists || st.Creates != len(blob.FolderRoles) {
		t.Fatal("recorded folders were looked up again")
	}

	// A reconnect or a second device without the rows finds the same
	// folders by their appProperties and creates none.
	f.storage.folders = newMemFolders()
	again, err := f.storage.EnsureFolders(ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	if n := f.drive.Stats().Creates - len(blob.FolderRoles); n != 0 {
		t.Fatalf("a second EnsureFolders created %d more folders", n)
	}
	for role, id := range first {
		if again[role] != id {
			t.Errorf("%s: found %s, created %s", role, again[role], id)
		}
	}
}

func TestStorageUploadsInChunksAndReadsBack(t *testing.T) {
	f := newStorageFixture(t)
	ctx, data := context.Background(), payload()
	up := uploadOf(data)
	got, err := f.storage.Put(ctx, f.user, up)
	if err != nil {
		t.Fatal(err)
	}
	if st := f.drive.Stats(); st.Chunks != 3 || st.Probes != 0 {
		t.Fatalf("%d chunks and %d probes", st.Chunks, st.Probes)
	}
	stored, meta, ok := f.drive.File(got.ID)
	if !ok || !bytes.Equal(stored, data) {
		t.Fatal("Drive holds other bytes than were sent")
	}
	folders, _ := f.folders.ListFolders(ctx, f.user)
	if meta.Name != up.Name || meta.MIME != "audio/webm" || len(meta.Parents) != 1 || meta.Parents[0] != folders[blob.FolderRecordings] {
		t.Fatalf("uploaded as %+v", meta)
	}
	want := map[string]string{propUser: f.user.String(), propKind: "recordings", propKey: up.Key, propSHA: up.SHA256}
	for k, v := range want {
		if meta.AppProperties[k] != v {
			t.Errorf("appProperties[%s] = %q, want %q", k, meta.AppProperties[k], v)
		}
	}

	r, err := f.storage.Open(ctx, f.user, got.ID, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	all, err := io.ReadAll(r)
	if err != nil || !bytes.Equal(all, data) {
		t.Fatalf("read back %d bytes, %v", len(all), err)
	}
}

func TestStorageResumesAnUploadAfterACut(t *testing.T) {
	f := newStorageFixture(t)
	// 512 KiB chunks: the first is cut after 256 KiB arrived, so the upload
	// must resume from the middle of a chunk, where the probe says.
	f.storage.chunk = 2 * chunkUnit
	f.drive.Configure(func(o *drivetest.Options) { o.CutChunks[1] = true })
	data := payload()
	got, err := f.storage.Put(context.Background(), f.user, uploadOf(data))
	if err != nil {
		t.Fatalf("the upload did not survive the cut: %v", err)
	}
	st := f.drive.Stats()
	if st.Chunks != 2 || st.Probes != 1 || st.Sessions != 1 {
		t.Fatalf("%d chunks, %d probes and %d sessions: the upload started over instead of resuming",
			st.Chunks, st.Probes, st.Sessions)
	}
	if stored, _, _ := f.drive.File(got.ID); !bytes.Equal(stored, data) {
		t.Fatal("the resumed upload holds other bytes")
	}
}

func TestStorageReopensAnExpiredSession(t *testing.T) {
	f := newStorageFixture(t)
	f.drive.Configure(func(o *drivetest.Options) { o.SessionGone = true })
	data := payload()
	got, err := f.storage.Put(context.Background(), f.user, uploadOf(data))
	if err != nil {
		t.Fatal(err)
	}
	if stored, _, _ := f.drive.File(got.ID); f.drive.Stats().Sessions != 2 || !bytes.Equal(stored, data) {
		t.Fatalf("%d sessions", f.drive.Stats().Sessions)
	}
}

func TestStorageRefusesAnUploadWhoseChecksumDiffers(t *testing.T) {
	f := newStorageFixture(t)
	f.drive.Configure(func(o *drivetest.Options) { o.CorruptMD5 = true })
	_, err := f.storage.Put(context.Background(), f.user, uploadOf(payload()))
	if !errors.Is(err, blob.ErrCorrupt) {
		t.Fatalf("a mismatched checksum was accepted: %v", err)
	}
	if n, st := f.drive.FileCount(), f.drive.Stats(); n != 0 || st.Deletes != 1 {
		t.Fatalf("the mismatched file was kept (%d files, %d deletes)", n, st.Deletes)
	}
}

func TestStorageRefusesABodyThatIsNotWhatWasPromised(t *testing.T) {
	f := newStorageFixture(t)
	up := uploadOf(payload())
	up.SHA256 = blob.Digest([]byte("something else"))
	if _, err := f.storage.Put(context.Background(), f.user, up); err == nil {
		t.Fatal("an upload with the wrong digest was sent")
	}
	if f.drive.Stats().Sessions != 0 {
		t.Fatal("a session was opened for it")
	}
}

func TestStorageReadsRangesLazily(t *testing.T) {
	f := newStorageFixture(t)
	ctx, data := context.Background(), payload()
	got, err := f.storage.Put(ctx, f.user, uploadOf(data))
	if err != nil {
		t.Fatal(err)
	}
	r, err := f.storage.Open(ctx, f.user, got.ID, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Range", "bytes=300000-300099")
	rec := httptest.NewRecorder()
	rec.Header().Set("Content-Type", "audio/webm")
	http.ServeContent(rec, req, "", time.Time{}, r)
	if rec.Code != http.StatusPartialContent || !bytes.Equal(rec.Body.Bytes(), data[300000:300100]) {
		t.Fatalf("range answered %d with %d bytes", rec.Code, rec.Body.Len())
	}
	// ServeContent's seeks to the end and back cost nothing: one range was
	// fetched, from where it was asked.
	ranges := f.drive.Stats().Ranges
	if len(ranges) != 1 || !strings.HasPrefix(ranges[0], "bytes=300000-") {
		t.Fatalf("ranges fetched: %v", ranges)
	}

	// A seek back reads from the new place.
	if _, err := r.Seek(10, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 5)
	if _, err := io.ReadFull(r, buf); err != nil || !bytes.Equal(buf, data[10:15]) {
		t.Fatalf("after a seek read %v, %v", buf, err)
	}
	ranges = f.drive.Stats().Ranges
	if last := ranges[len(ranges)-1]; !strings.HasPrefix(last, "bytes=10-") {
		t.Fatalf("the seek fetched %q", last)
	}
}

func TestStorageReportsAFileGoneFromDrive(t *testing.T) {
	f := newStorageFixture(t)
	ctx, data := context.Background(), payload()
	got, err := f.storage.Put(ctx, f.user, uploadOf(data))
	if err != nil {
		t.Fatal(err)
	}
	size := int64(len(data))
	f.drive.Trash(got.ID, true)
	if _, err := f.storage.Open(ctx, f.user, got.ID, size); !errors.Is(err, blob.ErrRemoved) {
		t.Fatalf("a trashed file: %v", err)
	}
	if _, err := f.storage.Open(ctx, f.user, got.ID, size+1); !errors.Is(err, blob.ErrRemoved) {
		t.Fatalf("trashed wins over size: %v", err)
	}
	f.drive.Trash(got.ID, false)
	if _, err := f.storage.Open(ctx, f.user, got.ID, size+1); !errors.Is(err, blob.ErrCorrupt) {
		t.Fatalf("a file of another size: %v", err)
	}
	if err := f.storage.Delete(ctx, f.user, got.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.storage.Open(ctx, f.user, got.ID, size); !errors.Is(err, blob.ErrRemoved) {
		t.Fatalf("a deleted file: %v", err)
	}
	// Deleting it again is not an error: it is gone, as asked.
	if err := f.storage.Delete(ctx, f.user, got.ID); err != nil {
		t.Fatalf("a second delete: %v", err)
	}
	if _, err := f.storage.Open(ctx, f.user, "../../etc", 1); err == nil {
		t.Fatal("a malformed id reached a URL")
	}
}

func TestStorageReportsAFullDrive(t *testing.T) {
	f := newStorageFixture(t)
	f.drive.Configure(func(o *drivetest.Options) { o.Quota = true })
	_, err := f.storage.Put(context.Background(), f.user, uploadOf(payload()))
	if !QuotaExceeded(err) {
		t.Fatalf("a full Drive answered %v", err)
	}
}

func TestStorageRefusesASessionOnAnotherHost(t *testing.T) {
	f := newStorageFixture(t)
	f.drive.Configure(func(o *drivetest.Options) { o.ForeignSession = true })
	if _, err := f.storage.Put(context.Background(), f.user, uploadOf(payload())); err == nil ||
		!strings.Contains(err.Error(), "upload host") {
		t.Fatalf("a session on another host: %v", err)
	}
	if f.drive.Stats().Chunks != 0 {
		t.Fatal("bytes were sent to it")
	}
}

// AC7: neither token ever appears in an error, whatever went wrong.
func TestStorageErrorsNeverCarryAToken(t *testing.T) {
	cases := map[string]func(t *testing.T, f *storageFixture){
		"full Drive": func(_ *testing.T, f *storageFixture) {
			f.drive.Configure(func(o *drivetest.Options) { o.Quota = true })
		},
		"a 500 that echoes": func(_ *testing.T, f *storageFixture) {
			f.drive.Configure(func(o *drivetest.Options) { o.Echo500 = true })
		},
		"checksum": func(_ *testing.T, f *storageFixture) {
			f.drive.Configure(func(o *drivetest.Options) { o.CorruptMD5 = true })
		},
		"foreign session": func(_ *testing.T, f *storageFixture) {
			f.drive.Configure(func(o *drivetest.Options) { o.ForeignSession = true })
		},
		"cut every time": func(_ *testing.T, f *storageFixture) {
			f.drive.Configure(func(o *drivetest.Options) {
				for i := 1; i < 20; i++ {
					o.CutChunks[i] = true
				}
			})
		},
		"refresh rejected": func(t *testing.T, f *storageFixture) {
			// The token endpoint answers invalid_grant and quotes the refresh
			// token back in its description.
			tokens := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(400)
				fmt.Fprintf(w, `{"error":"invalid_grant","error_description":"Bad Request"}`)
			}))
			t.Cleanup(tokens.Close)
			past := time.Now().Add(-time.Hour)
			f.store.conns[f.user].ExpiresAt = &past
			f.storage.svc.oauth.TokenURL = tokens.URL
		},
		"host not allowed": func(_ *testing.T, f *storageFixture) {
			f.storage.http = security.AllowlistClientOver(f.drive.Client(), "www.googleapis.com")
		},
	}
	for name, setup := range cases {
		t.Run(name, func(t *testing.T) {
			f := newStorageFixture(t)
			setup(t, f)
			_, err := f.storage.Put(context.Background(), f.user, uploadOf(payload()))
			if err == nil {
				t.Fatal("the upload succeeded")
			}
			for _, secret := range []string{drivetest.AccessToken, storageRefresh} {
				for _, text := range []string{err.Error(), fmt.Sprintf("%+v", err), fmt.Sprintf("%#v", err)} {
					if strings.Contains(text, secret) {
						t.Fatalf("the error carries a token: %s", text)
					}
				}
			}
		})
	}
}

// The session URL is a credential for the upload; a transport error names
// the host only.
func TestTransportErrorsNameTheHostOnly(t *testing.T) {
	u, _ := url.Parse("https://www.googleapis.com/upload/drive/v3/files?upload_id=SESSION-SECRET")
	err := transportError(http.MethodPut, u, &url.Error{Op: "Put", URL: u.String(), Err: io.ErrUnexpectedEOF})
	if strings.Contains(err.Error(), "SESSION-SECRET") || !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("transport error %q", err)
	}
}
