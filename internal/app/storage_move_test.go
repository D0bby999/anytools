package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/account"
	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/api/storageapi"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/connectors/drive/drivetest"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// storage_move_test.go — drive-user-storage phase 2 end to end: the
// learner's choice in users.file_storage, the router reading it, Settings →
// Storage's routes, and the storage_move job run by a real worker over
// Postgres, against drivetest's fake of Drive v3. The pieces are assembled
// the way wire_storage.go and buildDriveStorage assemble them, with the HTTP
// client pointed at the fake. No live Google run has been possible.

type storageRig struct {
	pool    *pg.Pool
	fake    *drivetest.Server
	local   *blob.Local
	router  *blob.Router
	backend *blob.Drive
	handler *storageapi.Handler
	worker  *jobs.Worker
	alice   uuid.UUID
	bob     uuid.UUID // no Drive connection
}

func newStorageRig(t *testing.T) *storageRig {
	t.Helper()
	ctx := context.Background()
	pool := testutil.TestDB(t)
	r := &storageRig{pool: pool, alice: testutil.NewUser(t, pool), bob: testutil.NewUser(t, pool)}
	future := time.Now().Add(time.Hour)
	conns := pg.NewDriveStore(pool, testutil.TestEncryptionKey)
	if err := conns.SaveConnection(ctx, drive.Connection{UserID: r.alice, Scope: drive.ScopeDriveFile,
		RefreshToken: "1//rig-refresh", AccessToken: drivetest.AccessToken, ExpiresAt: &future}); err != nil {
		t.Fatal(err)
	}
	connector := drive.NewService(drive.Config{Store: conns, OAuth: drive.OAuthConfig{ClientID: "id", ClientSecret: "secret"}})
	r.fake = drivetest.New(t)
	var err error
	if r.local, err = blob.NewLocal(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	cache, err := blob.NewCache(filepath.Join(r.local.Root(), blob.CacheDir), 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	files := pg.NewDriveFileStore(pool)
	r.backend, err = blob.NewDrive(blob.DriveConfig{
		Local: r.local,
		Remote: drive.NewStorage(connector, drive.StorageConfig{
			Folders:   files,
			HTTP:      security.AllowlistClientOver(r.fake.Client(), r.fake.Host()),
			BaseURL:   r.fake.DriveBase(),
			UploadURL: r.fake.UploadBase(),
			ChunkSize: drivetest.ChunkUnit,
		}),
		Index: files,
		Cache: cache,
		Title: files.Title,
	})
	if err != nil {
		t.Fatal(err)
	}
	users := pg.NewUserStore(pool)
	r.router = blob.NewRouter(r.local, blob.StorageChoice(r.local, r.backend, fileStorageOf(users)), r.backend)

	queue := jobs.NewQueue(pool, 0)
	kb := knowledgeSubsystem{driveFiles: r.backend, queue: queue, soloHandlers: map[string]jobs.Handler{}}
	r.handler = buildStorage(pool, kb, &driveConnector{svc: connector, store: conns}, users)
	r.worker = jobs.NewWorker(queue, "storage-test-"+uuid.NewString()[:8], time.Second)
	r.worker.Handle(storageapi.JobKind, kb.soloHandlers[storageapi.JobKind])
	return r
}

func (r *storageRig) call(t *testing.T, user uuid.UUID, method, path string, body any) (int, map[string]any) {
	t.Helper()
	mux := http.NewServeMux()
	r.handler.RegisterRoutes(mux)
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(raw))
	req = req.WithContext(httpx.WithUserID(req.Context(), user))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// runMove runs the queue until the learner's move has finished.
func (r *storageRig) runMove(t *testing.T, user uuid.UUID) map[string]any {
	t.Helper()
	for i := 0; i < 20; i++ {
		if _, err := r.worker.RunOnce(context.Background()); err != nil {
			t.Fatal(err)
		}
		_, st := r.call(t, user, http.MethodGet, "/v1/me/file-storage", nil)
		if m, _ := st["move"].(map[string]any); m != nil && m["status"] != "queued" && m["status"] != "running" {
			return st
		}
	}
	t.Fatal("the move never finished")
	return nil
}

func (r *storageRig) serverFiles(t *testing.T, user uuid.UUID) int {
	t.Helper()
	items, err := r.local.ListFiles(context.Background(), user)
	if err != nil {
		t.Fatal(err)
	}
	return len(items)
}

func errorCode(body map[string]any) string {
	if e, ok := body["error"].(map[string]any); ok {
		c, _ := e["code"].(string)
		return c
	}
	c, _ := body["code"].(string)
	return c
}

func TestChoosingDriveWithoutAConnectionIsRefusedWithItsReason(t *testing.T) {
	r := newStorageRig(t)
	code, body := r.call(t, r.bob, http.MethodPut, "/v1/me/file-storage", map[string]string{"storage": "drive"})
	if code != http.StatusConflict || errorCode(body) != "drive_not_connected" {
		t.Fatalf("PUT drive = %d %v", code, body)
	}
	var storage string
	if err := r.pool.QueryRow(context.Background(), `SELECT file_storage FROM users WHERE id = $1`, r.bob).Scan(&storage); err != nil || storage != "server" {
		t.Fatalf("file_storage = %q, %v", storage, err)
	}
	// Connected Drive alone never changes the choice (owner decision 2).
	_, st := r.call(t, r.alice, http.MethodGet, "/v1/me/file-storage", nil)
	if st["storage"] != "server" || st["drive"].(map[string]any)["ready"] != true {
		t.Fatalf("a connected learner's status = %v", st)
	}
}

func TestMovingFilesToDriveAndBackEndToEnd(t *testing.T) {
	r := newStorageRig(t)
	ctx, user := context.Background(), r.alice

	// Files written while the learner keeps them on the server.
	pdf := append([]byte("%PDF-1.7\n"), bytes.Repeat([]byte("page "), 120_000)...)
	digest, err := r.router.PutOriginal(ctx, user, pdf)
	if err != nil {
		t.Fatal(err)
	}
	rec := uuid.New()
	webm := append([]byte{0x1A, 0x45, 0xDF, 0xA3}, bytes.Repeat([]byte("opus"), 1000)...)
	if err := r.router.PutObject(ctx, user, "recordings", rec, webm); err != nil {
		t.Fatal(err)
	}
	if r.fake.FileCount() != 0 || r.serverFiles(t, user) != 2 {
		t.Fatal("a server learner's files did not stay on the server")
	}

	// Turning Drive on makes the folders, and moves nothing yet.
	code, body := r.call(t, user, http.MethodPut, "/v1/me/file-storage", map[string]string{"storage": "drive"})
	if code != http.StatusOK || body["storage"] != "drive" {
		t.Fatalf("PUT drive = %d %v", code, body)
	}
	if st := r.fake.Stats(); st.Creates != len(blob.FolderRoles) || r.fake.FileCount() != 0 {
		t.Fatalf("turning Drive on made %d folders and %d files", st.Creates, r.fake.FileCount())
	}

	// A new write goes to Drive.
	audioID := uuid.New()
	if err := r.router.PutObject(ctx, user, "audio", audioID, []byte("RIFF....WAVEfmt overview")); err != nil {
		t.Fatal(err)
	}
	if r.fake.FileCount() != 1 || r.serverFiles(t, user) != 2 {
		t.Fatal("a Drive learner's new file did not go to Drive")
	}

	// An earlier attempt uploaded the recording and stopped before
	// recording it: the move adopts that upload instead of making a second.
	sum := blob.Digest(webm)
	// An export saved earlier is the learner's, and stays through both moves.
	if _, err := r.backend.SaveExport(ctx, user, "warmup", "x.md", "text/markdown", []byte("x")); err != nil {
		t.Fatal(err)
	}
	uploads := r.fake.Stats().Sessions
	stale, err := r.backendRemote().Put(ctx, user, blob.RemoteUpload{Folder: blob.FolderRecordings, Name: "Recording.webm",
		MIME: "audio/webm", Kind: "recordings", Key: rec.String(), SHA256: sum, Size: int64(len(webm)), Body: bytes.NewReader(webm)})
	if err != nil {
		t.Fatal(err)
	}

	code, body = r.call(t, user, http.MethodPost, "/v1/me/file-storage/move", nil)
	if code != http.StatusAccepted {
		t.Fatalf("POST move = %d %v", code, body)
	}
	st := r.runMove(t, user)
	m := st["move"].(map[string]any)
	if m["status"] != "done" || m["done"] != 2.0 || m["total"] != 2.0 || m["direction"] != "to_drive" ||
		m["total_bytes"] != float64(len(pdf)+len(webm)) || m["done_bytes"] != m["total_bytes"] {
		t.Fatalf("move = %v", m)
	}
	if got := r.fake.Stats().Sessions - uploads; got != 2 { // the adopted one, and the PDF
		t.Fatalf("%d upload sessions, want 2 (the recording's was adopted)", got)
	}
	if r.serverFiles(t, user) != 0 {
		t.Fatal("server copies remain after the move to Drive")
	}
	var recFile string
	if err := r.pool.QueryRow(ctx, `SELECT drive_file_id FROM drive_files WHERE user_id = $1 AND kind = 'recordings' AND key = $2`,
		user, rec.String()).Scan(&recFile); err != nil || recFile != stale.ID {
		t.Fatalf("the recording's row names %q, want the adopted %q (%v)", recFile, stale.ID, err)
	}
	usage := st["usage"].(map[string]any)
	if usage["server_files"] != 0.0 || usage["drive_files"] != 3.0 {
		t.Fatalf("usage = %v", usage)
	}
	for kind, key := range map[string]string{blob.KindOriginal: digest, "recordings": rec.String()} {
		var got []byte
		if kind == blob.KindOriginal {
			got, err = r.router.GetOriginal(ctx, user, key)
		} else {
			got, err = r.router.GetObject(ctx, user, kind, rec)
		}
		if err != nil || (kind == blob.KindOriginal && !bytes.Equal(got, pdf)) || (kind != blob.KindOriginal && !bytes.Equal(got, webm)) {
			t.Fatalf("read %s after the move: %v", kind, err)
		}
	}

	// And back to the server.
	if code, body := r.call(t, user, http.MethodPut, "/v1/me/file-storage", map[string]string{"storage": "server"}); code != http.StatusOK {
		t.Fatalf("PUT server = %d %v", code, body)
	}
	if code, body := r.call(t, user, http.MethodPost, "/v1/me/file-storage/move", nil); code != http.StatusAccepted {
		t.Fatalf("POST move back = %d %v", code, body)
	}
	st = r.runMove(t, user)
	if m := st["move"].(map[string]any); m["status"] != "done" || m["done"] != 3.0 || m["direction"] != "to_server" {
		t.Fatalf("move back = %v", m)
	}
	if r.serverFiles(t, user) != 3 {
		t.Fatalf("%d files on the server after the move back, want 3", r.serverFiles(t, user))
	}
	var rows int
	if err := r.pool.QueryRow(ctx, `SELECT count(*) FROM drive_files WHERE user_id = $1`, user).Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("%d drive_files rows remain (%v)", rows, err)
	}
	if n := r.fake.FileCount(); n != 1 { // the export is the learner's and stays
		t.Fatalf("Drive holds %d files after the move back, want only the export", n)
	}
	if got, err := r.router.GetObject(ctx, user, "audio", audioID); err != nil || string(got) != "RIFF....WAVEfmt overview" {
		t.Fatalf("the overview after the move back = %q, %v", got, err)
	}
}

func (r *storageRig) backendRemote() *drive.Storage {
	// The same Storage the backend uses, rebuilt over the same connection
	// and fake, to stand in for an earlier attempt's upload.
	conns := pg.NewDriveStore(r.pool, testutil.TestEncryptionKey)
	connector := drive.NewService(drive.Config{Store: conns, OAuth: drive.OAuthConfig{ClientID: "id", ClientSecret: "secret"}})
	return drive.NewStorage(connector, drive.StorageConfig{
		Folders:   pg.NewDriveFileStore(r.pool),
		HTTP:      security.AllowlistClientOver(r.fake.Client(), r.fake.Host()),
		BaseURL:   r.fake.DriveBase(),
		UploadURL: r.fake.UploadBase(),
		ChunkSize: drivetest.ChunkUnit,
	})
}

// A copy whose sha256 in Drive is not the server's is removed again, and the
// server copy stays: the move finishes and counts it where it is.
func TestAMoveKeepsTheServerCopyWhenDrivesChecksumDiffers(t *testing.T) {
	r := newStorageRig(t)
	ctx, user := context.Background(), r.alice
	digest, err := r.router.PutOriginal(ctx, user, []byte("%PDF-1.7 short"))
	if err != nil {
		t.Fatal(err)
	}
	if code, body := r.call(t, user, http.MethodPut, "/v1/me/file-storage", map[string]string{"storage": "drive"}); code != http.StatusOK {
		t.Fatalf("PUT drive = %d %v", code, body)
	}
	r.fake.Configure(func(o *drivetest.Options) { o.CorruptSHA256 = true })
	if code, _ := r.call(t, user, http.MethodPost, "/v1/me/file-storage/move", nil); code != http.StatusAccepted {
		t.Fatalf("POST move = %d", code)
	}
	st := r.runMove(t, user)
	if st["move"].(map[string]any)["status"] != "done" || st["usage"].(map[string]any)["server_files"] != 1.0 {
		t.Fatalf("status = %v", st)
	}
	if _, err := os.Stat(filepath.Join(r.local.Root(), "originals", user.String(), digest[:2], digest)); err != nil {
		t.Fatalf("the server copy went: %v", err)
	}
	if r.fake.FileCount() != 0 {
		t.Fatal("the copy that did not match stayed in Drive")
	}
}

// A full Drive stops the move at once with its own code; nothing is lost.
func TestAMoveIntoAFullDriveStopsWithItsReason(t *testing.T) {
	r := newStorageRig(t)
	ctx, user := context.Background(), r.alice
	if _, err := r.router.PutOriginal(ctx, user, []byte("%PDF-1.7 short")); err != nil {
		t.Fatal(err)
	}
	if code, _ := r.call(t, user, http.MethodPut, "/v1/me/file-storage", map[string]string{"storage": "drive"}); code != http.StatusOK {
		t.Fatal("PUT drive")
	}
	r.fake.Configure(func(o *drivetest.Options) { o.Quota = true })
	if code, _ := r.call(t, user, http.MethodPost, "/v1/me/file-storage/move", nil); code != http.StatusAccepted {
		t.Fatal("POST move")
	}
	st := r.runMove(t, user)
	if m := st["move"].(map[string]any); m["status"] != "failed" || m["error"] != "drive_full" {
		t.Fatalf("move = %v", m)
	}
	if r.serverFiles(t, user) != 1 {
		t.Fatal("the server copy went")
	}
	// The job's own error text, which names Google's answer, is not shown.
	raw, _ := json.Marshal(st)
	if strings.Contains(string(raw), "storageQuotaExceeded") || strings.Contains(string(raw), drivetest.AccessToken) {
		t.Fatalf("status shows the job's error: %s", raw)
	}
}

// "Save to my Drive" writes into the Exports folder.
func TestSaveToMyDriveWritesIntoExports(t *testing.T) {
	r := newStorageRig(t)
	user := r.alice
	if code, _ := r.call(t, user, http.MethodPut, "/v1/me/file-storage", map[string]string{"storage": "drive"}); code != http.StatusOK {
		t.Fatal("PUT drive")
	}
	exports := r.handler.Exports()
	mux := http.NewServeMux()
	mux.HandleFunc("POST /x", func(w http.ResponseWriter, req *http.Request) {
		exports.Save(w, req, "worksheet:"+uuid.NewString(), "week-3.md", "# Week 3\n")
	})
	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	req = req.WithContext(httpx.WithUserID(req.Context(), user))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	var out struct {
		FileID string `json:"file_id"`
		Name   string `json:"name"`
		URL    string `json:"url"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); rec.Code != http.StatusCreated || err != nil {
		t.Fatalf("save = %d %s", rec.Code, rec.Body.Bytes())
	}
	data, meta, ok := r.fake.File(out.FileID)
	if !ok || string(data) != "# Week 3\n" || meta.MIME != "text/markdown" {
		t.Fatalf("Drive holds %q as %+v", data, meta)
	}
	if role, _, _ := r.fake.Folder(meta.Parents[0]); role != blob.FolderExports {
		t.Fatalf("saved into the %q folder", role)
	}
	if !strings.HasPrefix(meta.Name, "week-3 ") || !strings.HasSuffix(meta.Name, ".md") || !strings.HasSuffix(out.URL, "/"+out.FileID+"/view") {
		t.Fatalf("named %q, linked %q", meta.Name, out.URL)
	}
	// Exports are the learner's copies, not files AnyTools reads back.
	var rows int
	_ = r.pool.QueryRow(context.Background(), `SELECT count(*) FROM drive_files WHERE user_id = $1`, user).Scan(&rows)
	if rows != 0 {
		t.Fatal("an export was recorded in drive_files")
	}
	// Bob, with no Drive storage, is refused.
	req = httptest.NewRequest(http.MethodPost, "/x", nil)
	req = req.WithContext(httpx.WithUserID(req.Context(), r.bob))
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("bob's save = %d", rec.Code)
	}
}

// Account deletion through the learner's choice: the rows go first, then the
// router deletes the files of a learner who no longer exists. Nothing in
// their Drive is deleted (owner decision 1); the server's copies and the
// cache are.
func TestDeletingADriveLearnerThroughTheirChoice(t *testing.T) {
	r := newStorageRig(t)
	ctx, user := context.Background(), r.alice
	if code, _ := r.call(t, user, http.MethodPut, "/v1/me/file-storage", map[string]string{"storage": "drive"}); code != http.StatusOK {
		t.Fatal("PUT drive")
	}
	if err := r.router.PutObject(ctx, user, "recordings", uuid.New(), []byte("OggS in Drive")); err != nil {
		t.Fatal(err)
	}
	if err := r.local.PutObject(ctx, user, "transcripts", uuid.New(), []byte("derived, on the server")); err != nil {
		t.Fatal(err)
	}
	r.fake.Configure(func(o *drivetest.Options) { o.FailOnDelete = true })
	if err := account.New(r.pool, r.router, nil, nil).Delete(ctx, user); err != nil {
		t.Fatalf("account deletion: %v", err)
	}
	// account.Delete only logs a failure here, so ask the router directly:
	// a learner whose row is gone is not an error.
	if err := r.router.DeleteUser(ctx, user); err != nil {
		t.Fatalf("deleting a deleted learner's files: %v", err)
	}
	for _, dir := range []string{"objects", blob.CacheDir} {
		if _, err := os.Stat(filepath.Join(r.local.Root(), dir, user.String())); !os.IsNotExist(err) {
			t.Fatalf("%s/ of the deleted learner remains: %v", dir, err)
		}
	}
	if r.fake.FileCount() != 1 {
		t.Fatal("a file in the learner's Drive was deleted")
	}
}
