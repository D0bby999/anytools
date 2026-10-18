package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/account"
	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/connectors/drive/drivetest"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// drive_failures_e2e_test.go — drive-user-storage phase 3 through the API:
// the real handlers, the router, the Drive backend, drive_files and the
// encrypted connection in Postgres, against drivetest's fake of Drive v3 and
// a fake of Google's token endpoint. Shaped from Google's documentation; no
// live Google run has been possible.

type driveE2E struct {
	*e2e
	fake      *drivetest.Server
	conns     *pg.DriveStore
	connector *drive.Service
	router    *blob.Router
	cache     *blob.Cache
	local     *blob.Local
	refused   atomic.Bool
	kb        string
	doc       string
	pdf       []byte
}

func newDriveE2E(t *testing.T) *driveE2E {
	t.Helper()
	d := &driveE2E{fake: drivetest.New(t)}
	tokens := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/revoke" {
			return
		}
		if d.refused.Load() {
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprint(w, `{"error":"invalid_grant","error_description":"Token has been expired or revoked."}`)
			return
		}
		fmt.Fprintf(w, `{"access_token":%q,"expires_in":3599,"token_type":"Bearer"}`, drivetest.AccessToken)
	}))
	t.Cleanup(tokens.Close)

	model := newFakeModel(t)
	d.e2e = buildE2EStorage(t, model.server.URL, nil, nil, webDeps{}, nil, func(local *blob.Local, pool *pgxpool.Pool) e2eFiles {
		d.local = local
		d.conns = pg.NewDriveStore(pool, testutil.TestEncryptionKey)
		d.connector = drive.NewService(drive.Config{Store: d.conns, OAuth: drive.OAuthConfig{
			ClientID: "id", ClientSecret: "secret",
			TokenURL: tokens.URL, RevokeURL: tokens.URL + "/revoke", HTTP: tokens.Client(),
		}})
		files := pg.NewDriveFileStore(pool)
		remote := drive.NewStorage(d.connector, drive.StorageConfig{
			Folders: files, Files: files,
			HTTP:    security.AllowlistClientOver(d.fake.Client(), d.fake.Host()),
			BaseURL: d.fake.DriveBase(), UploadURL: d.fake.UploadBase(),
			ChunkSize: drivetest.ChunkUnit, Backoff: func(int) time.Duration { return 0 },
		})
		cache, err := blob.NewCache(filepath.Join(local.Root(), blob.CacheDir), 8<<20)
		if err != nil {
			t.Fatal(err)
		}
		d.cache = cache
		// As buildDriveStorage wires it.
		d.connector.UseStorage(remote)
		d.connector.OnLostAccess(func(u uuid.UUID) { _ = cache.DeleteUser(u) })
		backend, err := blob.NewDrive(blob.DriveConfig{Local: local, Remote: remote, Index: files, Cache: cache, Title: files.Title})
		if err != nil {
			t.Fatal(err)
		}
		// Phase 2's setting chooses per learner; here everyone is on Drive.
		d.router = blob.NewRouter(local, func(context.Context, uuid.UUID) (blob.Backend, error) { return backend, nil }, backend)
		return d.router
	})
	future := time.Now().Add(time.Hour)
	if err := d.conns.SaveConnection(context.Background(), drive.Connection{UserID: d.user, Scope: drive.ScopeDriveFile,
		RefreshToken: "1//e2e-refresh-SECRET", AccessToken: drivetest.AccessToken, ExpiresAt: &future}); err != nil {
		t.Fatal(err)
	}

	// One parsed PDF, kept in Drive.
	d.kb = d.json(http.MethodPost, "/v1/kb", map[string]string{"name": "Kept in Drive"}, http.StatusCreated)["id"].(string)
	d.pdf = ragFixturePDF(t)
	d.upload(uuid.MustParse(d.kb), "rag.pdf", d.pdf)
	d.drainJobs()
	docs := d.json(http.MethodGet, "/v1/kb/"+d.kb+"/documents", nil, http.StatusOK)["documents"].([]any)
	doc := docs[0].(map[string]any)
	if doc["status"] != "ready" {
		t.Fatalf("the PDF kept in Drive did not parse: %v", doc)
	}
	d.doc = doc["id"].(string)
	if d.fake.FileCount() != 1 {
		t.Fatalf("%d files in Drive after one upload", d.fake.FileCount())
	}
	return d
}

// reason reads a JSON error answer.
func (d *driveE2E) reason(method, path string, body io.Reader, contentType string) (int, httpx.ErrorBody) {
	d.t.Helper()
	req, _ := http.NewRequest(method, d.server.URL+path, body)
	req.Header.Set("Authorization", "Bearer "+e2eToken)
	req.Header.Set(httpx.UserIDHeader, d.user.String())
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	res, err := d.server.Client().Do(req)
	if err != nil {
		d.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out httpx.ErrorBody
	_ = json.Unmarshal(raw, &out)
	return res.StatusCode, out
}

func (d *driveE2E) viewFile() (int, httpx.ErrorBody) {
	d.t.Helper()
	ws := d.json(http.MethodPost, "/v1/reading/workspaces", map[string]any{"document_id": d.doc}, http.StatusOK)["id"].(string)
	return d.reason(http.MethodGet, "/v1/reading/"+ws+"/file", nil, "")
}

func (d *driveE2E) uploadAnswer(name string, data []byte) (int, httpx.ErrorBody) {
	d.t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, _ := w.CreateFormFile("file", name)
	_, _ = part.Write(data)
	_ = w.Close()
	return d.reason(http.MethodPost, "/v1/kb/"+d.kb+"/documents", &buf, w.FormDataContentType())
}

// searchWorks proves search reads the parsed text on the server, whatever
// became of the original.
func (d *driveE2E) searchWorks() {
	d.t.Helper()
	hits, _ := d.json(http.MethodPost, "/v1/kb/"+d.kb+"/query", map[string]any{"query": "retrieval augmented generation"}, http.StatusOK)["hits"].([]any)
	if len(hits) == 0 {
		d.t.Fatal("search found nothing")
	}
	d.json(http.MethodGet, "/v1/documents/"+d.doc+"/content", nil, http.StatusOK)
}

func (d *driveE2E) serverHolds(dir string) int {
	entries, _ := os.ReadDir(filepath.Join(d.local.Root(), dir, d.user.String()))
	return len(entries)
}

func TestARevokedDriveRefusesFilesButNotSearch(t *testing.T) {
	d := newDriveE2E(t)
	if status, _ := d.viewFile(); status != http.StatusOK {
		t.Fatalf("the viewer could not open the PDF: %d", status)
	}

	// Google revokes the grant: the stored token is past its time and the
	// refresh is refused. The next call to Drive finds out.
	d.refused.Store(true)
	if _, err := d.pool.Exec(context.Background(),
		`UPDATE drive_connections SET expires_at = now() - interval '1 hour' WHERE user_id = $1`, d.user); err != nil {
		t.Fatal(err)
	}
	status, body := d.uploadAnswer("notes.txt", []byte("written while Drive was revoked"))
	if status != http.StatusConflict || body.Code != "drive_reconnect" || body.Error != blob.ReasonReconnect.Message {
		t.Fatalf("an upload with a revoked Drive: %d %+v", status, body)
	}
	if n := d.serverHolds("originals"); n != 0 {
		t.Fatalf("a refused upload fell back to the server's disk (%d files)", n)
	}

	// Access is lost, so the cached copy went too: the viewer says why.
	status, body = d.viewFile()
	if status != http.StatusConflict || body.Code != "drive_reconnect" {
		t.Fatalf("the viewer with a revoked Drive: %d %+v", status, body)
	}
	if strings.Contains(body.Error, drivetest.AccessToken) || strings.Contains(body.Error, "SECRET") {
		t.Fatal("an answer carries a token")
	}
	d.searchWorks()

	// Re-embedding works from the chunks on the server, original or not.
	// (A re-parse, which needs the original, fails with the reason as the
	// document's error: TestAParseWhoseOriginalIsOutOfReachSaysWhy.)
	d.json(http.MethodPost, "/v1/kb/"+d.kb+"/reindex", map[string]any{}, http.StatusAccepted)
	d.drainJobs()
	d.searchWorks()

	// Reconnecting gives the same files back; nothing is copied.
	d.refused.Store(false)
	if err := d.connector.Connect(context.Background(), d.user, drive.Credentials{
		RefreshToken: "1//e2e-refresh-SECRET", AccessToken: drivetest.AccessToken, ExpiresIn: 3600, Scope: drive.ScopeDriveFile,
	}); err != nil {
		t.Fatal(err)
	}
	if status, body := d.viewFile(); status != http.StatusOK {
		t.Fatalf("after reconnecting the viewer answered %d %+v", status, body)
	}
	if d.fake.FileCount() != 1 {
		t.Fatalf("reconnecting changed what is in Drive: %d files", d.fake.FileCount())
	}
}

func TestAFileRemovedFromDriveIsMarkedAndAReuploadRelinksIt(t *testing.T) {
	d := newDriveE2E(t)
	ctx := context.Background()
	var fileID string
	if err := d.pool.QueryRow(ctx, `SELECT drive_file_id FROM drive_files WHERE user_id = $1 AND kind = 'original'`,
		d.user).Scan(&fileID); err != nil {
		t.Fatal(err)
	}
	// The learner deletes it in Drive; the server's cached copy has aged out.
	d.fake.Remove(fileID)
	if err := d.cache.DeleteUser(d.user); err != nil {
		t.Fatal(err)
	}
	status, body := d.viewFile()
	if status != http.StatusGone || body.Code != "drive_file_removed" || body.Error != blob.ReasonRemoved.Message {
		t.Fatalf("the viewer on a removed file: %d %+v", status, body)
	}
	var marked bool
	_ = d.pool.QueryRow(ctx, `SELECT missing_at IS NOT NULL FROM drive_files WHERE user_id = $1 AND kind = 'original'`, d.user).Scan(&marked)
	if !marked {
		t.Fatal("the removed file was not marked missing")
	}
	// Marked, it is answered without asking Drive again.
	checks := d.fake.Stats()
	if status, _ := d.viewFile(); status != http.StatusGone {
		t.Fatalf("a marked file answered %d", status)
	}
	if len(d.fake.Stats().Ranges) != len(checks.Ranges) {
		t.Fatal("a file marked missing was read from Drive again")
	}
	d.searchWorks()

	// Uploading the same file again relinks the document to it. The
	// knowledge base says it already has the document, which is true.
	status, body = d.uploadAnswer("rag.pdf", d.pdf)
	if status != http.StatusConflict || body.Code != "duplicate" {
		t.Fatalf("the re-upload answered %d %+v", status, body)
	}
	var relinked string
	_ = d.pool.QueryRow(ctx, `SELECT drive_file_id FROM drive_files WHERE user_id = $1 AND kind = 'original' AND missing_at IS NULL`,
		d.user).Scan(&relinked)
	if relinked == "" || relinked == fileID {
		t.Fatalf("the re-upload did not relink the row (%q)", relinked)
	}
	if err := d.cache.DeleteUser(d.user); err != nil {
		t.Fatal(err)
	}
	if status, body := d.viewFile(); status != http.StatusOK {
		t.Fatalf("after the re-upload the viewer answered %d %+v", status, body)
	}

	// Or the learner deletes the AnyTools row: that works too, with the
	// file gone from Drive.
	d.fake.Remove(relinked)
	d.json(http.MethodDelete, "/v1/kb/"+d.kb+"/documents/"+d.doc, nil, http.StatusNoContent)
}

func TestAFullDriveRefusesTheUploadAndKeepsNothing(t *testing.T) {
	d := newDriveE2E(t)
	d.fake.Configure(func(o *drivetest.Options) { o.Quota = true })
	status, body := d.uploadAnswer("notes.txt", []byte("one file too many"))
	if status != http.StatusInsufficientStorage || body.Code != "drive_full" || body.Error != blob.ReasonFull.Message {
		t.Fatalf("an upload into a full Drive: %d %+v", status, body)
	}
	for _, dir := range []string{"originals", "objects"} {
		if n := d.serverHolds(dir); n != 0 {
			t.Fatalf("a refused upload left %d entries under %s/", n, dir)
		}
	}
	if docs := d.json(http.MethodGet, "/v1/kb/"+d.kb+"/documents", nil, http.StatusOK)["documents"].([]any); len(docs) != 1 {
		t.Fatalf("a refused upload left a document row (%d documents)", len(docs))
	}
	d.searchWorks()
}

// Account deletion with the real disconnector: the grant is revoked at
// Google, the rows and the cache go, and nothing in the learner's Drive is
// deleted (owner decision 1). The fake fails the test on any files.delete.
func TestAccountDeletionLeavesTheLearnersDriveAlone(t *testing.T) {
	d := newDriveE2E(t)
	ctx := context.Background()
	d.fake.Configure(func(o *drivetest.Options) {
		o.FailOnDelete = true
		o.Requests = func(r *http.Request) {
			if r.Method == http.MethodDelete {
				t.Errorf("account deletion sent %s %s", r.Method, r.URL.Path)
			}
		}
	})
	files, folders := d.fake.FileCount(), d.fake.FolderCount()
	if err := account.New(d.pool, d.router, d.connector, nil).Delete(ctx, d.user); err != nil {
		t.Fatal(err)
	}
	var rows int
	_ = d.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM drive_files WHERE user_id = $1) +
		(SELECT count(*) FROM drive_folders WHERE user_id = $1) +
		(SELECT count(*) FROM drive_connections WHERE user_id = $1)`, d.user).Scan(&rows)
	if rows != 0 {
		t.Fatalf("%d Drive rows outlived the account", rows)
	}
	if _, err := os.Stat(filepath.Join(d.local.Root(), blob.CacheDir, d.user.String())); !os.IsNotExist(err) {
		t.Fatalf("the cache outlived the account: %v", err)
	}
	if d.fake.FileCount() != files || d.fake.FolderCount() != folders || d.fake.Stats().Deletes != 0 {
		t.Fatal("account deletion deleted something in the learner's Drive")
	}
}

// A worksheet recording kept in Drive: removed there, it says so instead of
// "recording missing"; into a full Drive, the take is refused with its reason
// and nothing is kept on the server.
func TestAWorksheetRecordingInDriveSaysWhy(t *testing.T) {
	d := newDriveE2E(t)
	ctx := context.Background()
	sheet := d.json(http.MethodPost, "/v1/worksheets", map[string]any{"kind": "speaking_evidence", "title": "Standup"}, http.StatusCreated)
	base := "/v1/worksheets/" + sheet["id"].(string) + "/recordings"
	webm := append([]byte{0x1A, 0x45, 0xDF, 0xA3}, bytes.Repeat([]byte("opus"), 1000)...)
	body, ct := recordingForm(t, "audio/webm", webm, "12")
	res, raw := d.send(d.user, http.MethodPost, base, body, ct, nil)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("keep a take: %d %s", res.StatusCode, raw)
	}
	var rec struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &rec)
	var fileID string
	if err := d.pool.QueryRow(ctx, `SELECT drive_file_id FROM drive_files WHERE user_id = $1 AND kind = 'recordings' AND key = $2`,
		d.user, rec.ID).Scan(&fileID); err != nil {
		t.Fatalf("the take is not in Drive: %v", err)
	}

	d.fake.Remove(fileID)
	_ = d.cache.DeleteUser(d.user)
	status, reason := d.reason(http.MethodGet, base+"/"+rec.ID, nil, "")
	if status != http.StatusGone || reason.Code != "drive_file_removed" {
		t.Fatalf("a take removed from Drive answered %d %+v", status, reason)
	}

	d.fake.Configure(func(o *drivetest.Options) { o.Quota = true })
	body, ct = recordingForm(t, "audio/webm", webm, "12")
	res, raw = d.send(d.user, http.MethodPost, base, body, ct, nil)
	if res.StatusCode != http.StatusInsufficientStorage || !strings.Contains(string(raw), `"drive_full"`) {
		t.Fatalf("a take into a full Drive: %d %s", res.StatusCode, raw)
	}
	if n := d.serverHolds("objects"); n != 0 {
		t.Fatalf("a refused take left %d entries on the server", n)
	}
}
