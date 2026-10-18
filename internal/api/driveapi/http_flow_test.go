package driveapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/api"
	"github.com/D0bby999/anytools/internal/api/driveapi"
	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/api/kbapi"
	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/rag/retrieve"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// http_flow_test.go — the phase's end-to-end claim, driven through the real mux.
//
// Real stores, real encryption, real knowledge.Service, real authorization, the
// real RequireUser chokepoint in front of everything. The only thing standing
// in is GOOGLE: a fake Drive whose fixture files can be EDITED mid-test, which
// is how "edit one Doc and exactly one document re-imports" gets asserted
// without a Google account. No live credentials exist — the owner has not
// created the GCP project yet (reports/spike-drive.md) — so the alternative to
// this server is not a better test, it is no test.

const gatewayToken = "test-gateway-token"

// ─────────────────────────────────────────────────────────── the fake Google

// fakeDrive is a mutable stand-in for Drive v3 plus the token endpoint.
//
// Mutable on purpose: a test edits a file and polls, exactly as a user would.
type fakeDrive struct {
	mu sync.Mutex

	files    map[string]*driveFile
	children map[string][]string

	// token feed
	startPageToken string
	changes        []map[string]any
	// gone makes the next changes.list answer 410, so the re-baseline path runs.
	gone bool
	// forbid makes every read of these ids answer 403 insufficientFilePermissions.
	forbid map[string]bool

	calls []string
}

type driveFile struct {
	ID       string
	Name     string
	MimeType string
	MD5      string
	Modified string
	Content  []byte
	Trashed  bool
}

func newFakeDrive() *fakeDrive {
	return &fakeDrive{
		files:          map[string]*driveFile{},
		children:       map[string][]string{},
		forbid:         map[string]bool{},
		startPageToken: "1000",
	}
}

func (f *fakeDrive) add(parent string, file *driveFile) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.files[file.ID] = file
	if parent != "" {
		f.children[parent] = append(f.children[parent], file.ID)
	}
}

// edit changes a file's content and records the change in the feed, the way
// Drive does when someone types in a Doc.
func (f *fakeDrive) edit(id, content, modified string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	file := f.files[id]
	file.Content = []byte(content)
	file.Modified = modified
	if file.MD5 != "" {
		file.MD5 = fmt.Sprintf("%x", len(content)*7919)
	}
	f.changes = append(f.changes, map[string]any{
		"changeType": "file", "removed": false, "fileId": id,
		"file": f.metaLocked(file),
	})
}

func (f *fakeDrive) metaLocked(file *driveFile) map[string]any {
	m := map[string]any{
		"id": file.ID, "name": file.Name, "mimeType": file.MimeType,
		"modifiedTime": file.Modified, "trashed": file.Trashed,
	}
	if file.MD5 != "" {
		m["md5Checksum"] = file.MD5
	}
	return m
}

func (f *fakeDrive) handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{
			"access_token": "ya29.fake", "token_type": "Bearer",
			"expires_in": 3599, "scope": drive.ScopeDriveFile,
		})
	})

	mux.HandleFunc("GET /drive/v3/changes/startPageToken", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.calls = append(f.calls, "getStartPageToken")
		writeJSON(w, 200, map[string]any{"startPageToken": f.startPageToken})
	})

	mux.HandleFunc("GET /drive/v3/changes", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.calls = append(f.calls, "changes.list")
		if f.gone {
			f.gone = false
			writeJSON(w, http.StatusGone, errEnvelope(410, "pageTokenInvalid", "Page token expired"))
			return
		}
		changes := f.changes
		f.changes = nil
		next := bumpToken(f.startPageToken)
		f.startPageToken = next
		writeJSON(w, 200, map[string]any{"changes": changes, "newStartPageToken": next})
	})

	mux.HandleFunc("GET /drive/v3/files", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.calls = append(f.calls, "files.list")
		folder := parentFromQuery(r.URL.Query().Get("q"))
		if f.forbid[folder] {
			writeJSON(w, http.StatusForbidden,
				errEnvelope(403, "insufficientFilePermissions", "The user does not have sufficient permissions for this file."))
			return
		}
		out := []map[string]any{}
		for _, id := range f.children[folder] {
			if file := f.files[id]; file != nil && !file.Trashed {
				out = append(out, f.metaLocked(file))
			}
		}
		writeJSON(w, 200, map[string]any{"files": out})
	})

	mux.HandleFunc("GET /drive/v3/files/{id}/export", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		id := r.PathValue("id")
		f.calls = append(f.calls, "export:"+id)
		if f.forbid[id] {
			writeJSON(w, http.StatusForbidden,
				errEnvelope(403, "insufficientFilePermissions", "The user does not have sufficient permissions for this file."))
			return
		}
		file := f.files[id]
		if file == nil {
			writeJSON(w, http.StatusNotFound, errEnvelope(404, "notFound", "File not found"))
			return
		}
		w.Header().Set("Content-Type", r.URL.Query().Get("mimeType"))
		_, _ = w.Write(file.Content)
	})

	mux.HandleFunc("GET /drive/v3/files/{id}", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		id := r.PathValue("id")
		f.calls = append(f.calls, "files.get:"+id)
		if f.forbid[id] {
			writeJSON(w, http.StatusForbidden,
				errEnvelope(403, "insufficientFilePermissions", "The user does not have sufficient permissions for this file."))
			return
		}
		file := f.files[id]
		if file == nil {
			writeJSON(w, http.StatusNotFound, errEnvelope(404, "notFound", "File not found"))
			return
		}
		if r.URL.Query().Get("alt") == "media" {
			w.Header().Set("Content-Type", file.MimeType)
			_, _ = w.Write(file.Content)
			return
		}
		writeJSON(w, 200, f.metaLocked(file))
	})

	return mux
}

func (f *fakeDrive) callsSince(n int) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.calls[n:]...)
}

func (f *fakeDrive) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

func errEnvelope(code int, reason, message string) map[string]any {
	return map[string]any{"error": map[string]any{
		"code": code, "message": message,
		"errors": []map[string]any{{"reason": reason, "message": message}},
	}}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=UTF-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func parentFromQuery(q string) string {
	// q is `'<id>' in parents and trashed = false`.
	start := 1
	end := 1
	for end < len(q) && q[end] != '\'' {
		end++
	}
	if end >= len(q) {
		return ""
	}
	return q[start:end]
}

func bumpToken(tok string) string {
	n := 0
	fmt.Sscanf(tok, "%d", &n)
	return fmt.Sprint(n + 1)
}

// ──────────────────────────────────────────────────────────────── the harness

type env struct {
	t       *testing.T
	pool    *pgxpool.Pool
	handler http.Handler
	google  *fakeDrive
	alice   uuid.UUID
	bob     uuid.UUID
}

func newEnv(t *testing.T) *env {
	t.Helper()
	pool := testutil.TestDB(t)

	google := newFakeDrive()
	srv := httptest.NewServer(google.handler())
	t.Cleanup(srv.Close)

	e := &env{t: t, pool: pool, google: google}
	e.alice = makeUser(t, pool, "alice")
	e.bob = makeUser(t, pool, "bob")

	blobs, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatalf("blob store: %v", err)
	}
	kbStore := pg.NewKnowledgeStore(pool)
	driveStore := pg.NewDriveStore(pool, testutil.TestEncryptionKey)
	queue := jobs.NewQueue(pool, time.Minute)

	svc := knowledge.NewService(knowledge.Config{
		Store: kbStore, Chunks: pg.NewChunkStore(pool), Blobs: blobs, Jobs: queue,
		Providers: noProviders{}, Events: knowledge.NewEvents(),
	})
	authorizer := authz.New(kbStore)

	connector := drive.NewService(drive.Config{
		Store:    driveStore,
		Importer: driveImporter{svc: svc, docs: driveStore},
		Authz:    authorizer,
		OAuth: drive.OAuthConfig{
			ClientID: "id.apps.googleusercontent.com", ClientSecret: "secret",
			TokenURL: srv.URL + "/token", RevokeURL: srv.URL + "/token",
		},
		BaseURL:        srv.URL + "/drive/v3",
		MaxImportBytes: knowledge.MaxUploadBytes,
	})

	e.handler = api.BuildMux(api.Deps{
		Knowledge:    kbapi.NewHandler(svc, authorizer, retrieve.New(pool), noProviders{}),
		Drive:        driveapi.NewHandler(connector),
		Users:        userLookup{pool},
		GatewayToken: gatewayToken,
	})
	return e
}

// driveImporter is the same adapter internal/app/wire_drive.go installs.
type driveImporter struct {
	svc  *knowledge.Service
	docs knowledge.ExternalDocuments
}

func (d driveImporter) Import(ctx context.Context, req drive.ImportRequest) (uuid.UUID, error) {
	res, err := d.svc.ImportExternal(ctx, d.docs, knowledge.ExternalImport{
		UserID: req.UserID, KBID: req.KBID, SourceKind: knowledge.SourceDrive,
		ExternalID: req.ExternalID, Filename: req.Filename, Data: req.Data,
	})
	if err != nil {
		return uuid.Nil, err
	}
	return res.Document.ID, nil
}

// noProviders is the "no AI account configured" state, which is correct here:
// this test asserts the CONNECTOR's behaviour, and a Drive import creates the
// document and queues the job whether or not a model exists to parse it.
type noProviders struct{}

func (noProviders) ParserChain(context.Context, knowledge.UserID) ([]knowledge.Parser, error) {
	return nil, nil
}
func (noProviders) EmbedderFor(context.Context, knowledge.UserID) (knowledge.Embedder, error) {
	return nil, fmt.Errorf("no embedding model is configured")
}

func (e *env) do(user uuid.UUID, method, path string, body any) *httptest.ResponseRecorder {
	e.t.Helper()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			e.t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Authorization", "Bearer "+gatewayToken)
	if user != uuid.Nil {
		req.Header.Set(httpx.UserIDHeader, user.String())
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	return rec
}

func (e *env) connect(user uuid.UUID) {
	e.t.Helper()
	rec := e.do(user, http.MethodPost, "/v1/connectors/drive/credentials", map[string]any{
		"refresh_token": "1//0g-" + user.String(),
		"access_token":  "ya29.initial",
		"expires_in":    3600,
		"scope":         drive.ScopeDriveFile,
		"email":         "owner@example.test",
	})
	if rec.Code != http.StatusOK {
		e.t.Fatalf("connect: %d %s", rec.Code, rec.Body.String())
	}
}

func (e *env) createKB(user uuid.UUID, name string) uuid.UUID {
	e.t.Helper()
	rec := e.do(user, http.MethodPost, "/v1/kb", map[string]string{"name": name})
	if rec.Code != http.StatusCreated {
		e.t.Fatalf("create kb: %d %s", rec.Code, rec.Body.String())
	}
	var kb struct {
		ID uuid.UUID `json:"id"`
	}
	decode(e.t, rec, &kb)
	return kb.ID
}

// documentVersions reads (drive_file_id → version) straight from the database.
type docRow struct {
	ID      uuid.UUID
	Version int
	Status  string
	Title   string
}

func (e *env) documents(user, kb uuid.UUID) map[string]docRow {
	e.t.Helper()
	rows, err := e.pool.Query(context.Background(),
		`SELECT drive_file_id, id, version, status, title FROM documents
		 WHERE user_id = $1 AND kb_id = $2 AND source_kind = 'drive'`, user, kb)
	if err != nil {
		e.t.Fatalf("read documents: %v", err)
	}
	defer rows.Close()
	out := map[string]docRow{}
	for rows.Next() {
		var fileID string
		var d docRow
		if err := rows.Scan(&fileID, &d.ID, &d.Version, &d.Status, &d.Title); err != nil {
			e.t.Fatalf("scan document: %v", err)
		}
		out[fileID] = d
	}
	return out
}

func (e *env) grants(user, kb uuid.UUID) map[string]drive.Grant {
	e.t.Helper()
	rec := e.do(user, http.MethodGet, "/v1/kb/"+kb.String()+"/drive/grants", nil)
	if rec.Code != http.StatusOK {
		e.t.Fatalf("list grants: %d %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Grants []drive.Grant `json:"grants"`
	}
	decode(e.t, rec, &payload)
	out := map[string]drive.Grant{}
	for _, g := range payload.Grants {
		out[g.FileID] = g
	}
	return out
}

func (e *env) sync(user uuid.UUID) drive.SyncReport {
	e.t.Helper()
	rec := e.do(user, http.MethodPost, "/v1/connectors/drive/sync", nil)
	if rec.Code != http.StatusOK {
		e.t.Fatalf("sync: %d %s", rec.Code, rec.Body.String())
	}
	var report drive.SyncReport
	decode(e.t, rec, &report)
	return report
}

func decode(t *testing.T, rec *httptest.ResponseRecorder, v any) {
	t.Helper()
	if err := json.Unmarshal(rec.Body.Bytes(), v); err != nil {
		t.Fatalf("decode %s: %v", rec.Body.String(), err)
	}
}

func makeUser(t *testing.T, pool *pgxpool.Pool, label string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id`,
		"driveapi-"+uuid.NewString()+"@example.test", label).Scan(&id)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

type userLookup struct{ pool *pgxpool.Pool }

func (u userLookup) UserExists(ctx context.Context, id uuid.UUID) (bool, error) {
	var exists bool
	err := u.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL)`, id).Scan(&exists)
	return exists, err
}

// seedFolder puts a folder with a Doc and a Markdown file in the fake Drive.
func (e *env) seedFolder() string {
	const folderID = "folder-kb"
	e.google.add("", &driveFile{ID: folderID, Name: "Course", MimeType: drive.MimeGoogleFolder})
	e.google.add(folderID, &driveFile{
		ID: "doc-notes", Name: "Week One Notes", MimeType: drive.MimeGoogleDoc,
		Modified: "2026-09-10T08:00:00.000Z", Content: []byte("# Week 1\n\nRetrieval beats generation.\n"),
	})
	e.google.add(folderID, &driveFile{
		ID: "md-syllabus", Name: "syllabus.md", MimeType: "text/markdown",
		Modified: "2026-09-10T08:00:00.000Z", MD5: "aaa111", Content: []byte("# Syllabus\n\nWeek 1: retrieval.\n"),
	})
	return folderID
}
