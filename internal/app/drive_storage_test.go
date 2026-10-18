package app

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/account"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/connectors/drive/drivetest"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// drive_storage_test.go — drive-user-storage phase 1 end to end below the
// API: the router, the Drive backend, drive_files in Postgres, the stored
// (encrypted) Drive connection and Storage, against drivetest's fake of
// Drive v3. The pieces are assembled the way buildDriveStorage assembles
// them, with the HTTP client pointed at the fake. No live Google run has
// been possible.

type driveStorageRig struct {
	fake   *drivetest.Server
	local  *blob.Local
	cache  *blob.Cache
	router *blob.Router
	user   uuid.UUID
}

func newDriveStorageRig(t *testing.T) *driveStorageRig {
	t.Helper()
	ctx := context.Background()
	pool := testutil.TestDB(t)
	user := testutil.NewUser(t, pool)
	future := time.Now().Add(time.Hour)
	conns := pg.NewDriveStore(pool, testutil.TestEncryptionKey)
	if err := conns.SaveConnection(ctx, drive.Connection{UserID: user, Scope: drive.ScopeDriveFile,
		RefreshToken: "1//rig-refresh", AccessToken: drivetest.AccessToken, ExpiresAt: &future}); err != nil {
		t.Fatal(err)
	}
	connector := drive.NewService(drive.Config{Store: conns, OAuth: drive.OAuthConfig{ClientID: "id", ClientSecret: "secret"}})

	fake := drivetest.New(t)
	local, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cache, err := blob.NewCache(filepath.Join(local.Root(), blob.CacheDir), 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	files := pg.NewDriveFileStore(pool)
	backend, err := blob.NewDrive(blob.DriveConfig{
		Local: local,
		Remote: drive.NewStorage(connector, drive.StorageConfig{
			Folders:   files,
			HTTP:      security.AllowlistClientOver(fake.Client(), fake.Host()),
			BaseURL:   fake.DriveBase(),
			UploadURL: fake.UploadBase(),
			ChunkSize: drivetest.ChunkUnit,
		}),
		Index: files,
		Cache: cache,
		Title: files.Title,
	})
	if err != nil {
		t.Fatal(err)
	}
	// Phase 2's setting will choose per learner; here everyone is on Drive.
	router := blob.NewRouter(local, func(context.Context, uuid.UUID) (blob.Backend, error) { return backend, nil }, backend)
	return &driveStorageRig{fake: fake, local: local, cache: cache, router: router, user: user}
}

func TestDriveStorageEndToEnd(t *testing.T) {
	rig := newDriveStorageRig(t)
	ctx, user := context.Background(), rig.user
	pool := testutil.TestDB(t)

	// An upload lands in Uploads, and nothing of it under originals/.
	pdf := append([]byte("%PDF-1.7\n"), bytes.Repeat([]byte("page "), 120_000)...)
	digest, err := rig.router.PutOriginal(ctx, user, pdf)
	if err != nil {
		t.Fatal(err)
	}
	var fileID string
	if err := pool.QueryRow(ctx, `SELECT drive_file_id FROM drive_files WHERE user_id = $1 AND kind = 'original' AND key = $2`,
		user, digest).Scan(&fileID); err != nil {
		t.Fatalf("no drive_files row: %v", err)
	}
	stored, meta, ok := rig.fake.File(fileID)
	if !ok || !bytes.Equal(stored, pdf) {
		t.Fatal("Drive does not hold the upload")
	}
	if role, _, _ := rig.fake.Folder(meta.Parents[0]); role != blob.FolderUploads || !strings.HasSuffix(meta.Name, ".pdf") {
		t.Fatalf("uploaded as %q into the %q folder", meta.Name, role)
	}
	if _, err := os.Stat(filepath.Join(rig.local.Root(), "originals", user.String())); !os.IsNotExist(err) {
		t.Fatalf("the upload was also written to the server's disk: %v", err)
	}
	if st := rig.fake.Stats(); st.Chunks < 2 {
		t.Fatalf("a %d-byte upload went in %d chunk(s)", len(pdf), st.Chunks)
	}

	// Parsed text stays on the server.
	parsed, err := rig.router.PutParsed(ctx, user, uuid.New(), 1, "# page 1")
	if err != nil || !strings.HasPrefix(parsed, rig.local.Root()) {
		t.Fatalf("parsed text: %q, %v", parsed, err)
	}

	// A recording plays with seeking, from Drive, once the cache is cold.
	rec := uuid.New()
	webm := append([]byte{0x1A, 0x45, 0xDF, 0xA3}, bytes.Repeat([]byte("opus"), 100_000)...)
	if err := rig.router.PutObject(ctx, user, "recordings", rec, webm); err != nil {
		t.Fatal(err)
	}
	if err := rig.cache.DeleteUser(user); err != nil {
		t.Fatal(err)
	}
	f, err := rig.router.OpenObject(ctx, user, "recordings", rec)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Range", "bytes=200000-200009")
	w := httptest.NewRecorder()
	w.Header().Set("Content-Type", "audio/webm")
	http.ServeContent(w, req, "", f.ModTime, f)
	f.Close()
	if w.Code != http.StatusPartialContent || !bytes.Equal(w.Body.Bytes(), webm[200000:200010]) {
		t.Fatalf("seek answered %d with %q", w.Code, w.Body.Bytes())
	}

	// A full read comes back whole and checked, and is cached for the next.
	got, err := rig.router.GetOriginal(ctx, user, digest)
	if err != nil || !bytes.Equal(got, pdf) {
		t.Fatalf("read back %d bytes, %v", len(got), err)
	}
	ranges := len(rig.fake.Stats().Ranges)
	if _, err := rig.router.GetOriginal(ctx, user, digest); err != nil {
		t.Fatal(err)
	}
	if len(rig.fake.Stats().Ranges) != ranges {
		t.Fatal("a file just read was read from Drive again")
	}

	// Account deletion: the rows and the cache go; nothing in Drive is
	// deleted (owner decision 1). The fake fails the test on any delete.
	rig.fake.Configure(func(o *drivetest.Options) { o.FailOnDelete = true })
	files := rig.fake.FileCount()
	if err := account.New(pool, rig.router, nil, nil).Delete(ctx, user); err != nil {
		t.Fatal(err)
	}
	var rows int
	_ = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM drive_files WHERE user_id = $1) +
		(SELECT count(*) FROM drive_folders WHERE user_id = $1)`, user).Scan(&rows)
	if rows != 0 {
		t.Fatalf("%d drive rows outlived the account", rows)
	}
	if _, err := os.Stat(filepath.Join(rig.local.Root(), blob.CacheDir, user.String())); !os.IsNotExist(err) {
		t.Fatalf("the cache outlived the account: %v", err)
	}
	if rig.fake.FileCount() != files || rig.fake.Stats().Deletes != 0 {
		t.Fatal("account deletion deleted files in the learner's Drive")
	}
}

// A Drive refusal fails the write; nothing is kept on the server instead.
func TestDriveStorageRefusalLeavesNothingOnTheServer(t *testing.T) {
	rig := newDriveStorageRig(t)
	ctx := context.Background()
	rig.fake.Configure(func(o *drivetest.Options) { o.Quota = true })
	_, err := rig.router.PutOriginal(ctx, rig.user, []byte("%PDF-1.7 too much"))
	if !drive.QuotaExceeded(err) {
		t.Fatalf("a full Drive answered %v", err)
	}
	for _, dir := range []string{"originals", "objects", blob.CacheDir} {
		entries, _ := os.ReadDir(filepath.Join(rig.local.Root(), dir, rig.user.String()))
		if len(entries) != 0 {
			t.Fatalf("a refused upload left %d entries under %s/", len(entries), dir)
		}
	}
}
