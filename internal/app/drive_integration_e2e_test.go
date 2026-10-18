package app

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"mime/multipart"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/connectors/drive/drivetest"
)

// drive_integration_e2e_test.go — drive-user-storage phase 4: what the
// earlier phases left to the integration. A parse that could not read its
// original from Drive tells the page which reason it was, and no Drive
// credential (the access and refresh tokens, or a resumable session URL)
// reaches a log line, an answer or a row, whatever Drive does. Against
// drivetest; no live Google run has been possible.

// A parse that cannot read its original from the learner's Drive fails with
// the reason's sentence, and the document carries the reason's code, so the
// page can offer "Reconnect Google Drive" instead of plain text.
func TestAParseThatCannotReachDriveCarriesItsReason(t *testing.T) {
	d := newDriveE2E(t)
	ctx := context.Background()

	// Removed from Drive between the upload and its parse, with the cached
	// copy gone.
	d.upload(uuid.MustParse(d.kb), "removed.txt", []byte("a note the learner deleted in Drive before it was read"))
	var fileID string
	if err := d.pool.QueryRow(ctx, `SELECT f.drive_file_id FROM drive_files f JOIN documents doc
		ON doc.user_id = f.user_id AND doc.sha256 = f.key AND f.kind = 'original'
		WHERE doc.user_id = $1 AND doc.title LIKE 'removed%'`, d.user).Scan(&fileID); err != nil {
		t.Fatalf("the upload is not in Drive: %v", err)
	}
	d.fake.Remove(fileID)
	if err := d.cache.DeleteUser(d.user); err != nil {
		t.Fatal(err)
	}
	d.drainJobs()
	removed := d.documentTitled("removed")
	if removed["status"] != "failed" || removed["error"] != blob.ReasonRemoved.Message || removed["error_code"] != "drive_file_removed" {
		t.Fatalf("a parse whose original was removed from Drive: %v", removed)
	}

	// Revoked between the upload and its parse.
	d.upload(uuid.MustParse(d.kb), "revoked.txt", []byte("a note uploaded just before Google stopped honouring the grant"))
	if err := d.cache.DeleteUser(d.user); err != nil {
		t.Fatal(err)
	}
	d.refused.Store(true)
	if _, err := d.pool.Exec(ctx, `UPDATE drive_connections SET expires_at = now() - interval '1 hour' WHERE user_id = $1`, d.user); err != nil {
		t.Fatal(err)
	}
	d.drainJobs()
	revoked := d.documentTitled("revoked")
	if revoked["status"] != "failed" || revoked["error_code"] != "drive_reconnect" {
		t.Fatalf("a parse whose Drive was revoked: %v", revoked)
	}
	// The same document read alone says the same.
	one, _ := d.json(http.MethodGet, "/v1/documents/"+revoked["id"].(string), nil, http.StatusOK)["document"].(map[string]any)
	if one["error_code"] != "drive_reconnect" {
		t.Fatalf("GET /v1/documents/{id} lost the code: %v", one)
	}

	// The PDF that parsed before any of this carries no code.
	ready := d.documentTitled("rag")
	if _, has := ready["error_code"]; has || ready["status"] != "ready" {
		t.Fatalf("a ready document carries a code: %v", ready)
	}
	// A document that is no longer failed carries no code, whatever text
	// its error column still holds.
	if _, err := d.pool.Exec(ctx, `UPDATE documents SET status = 'ready' WHERE id = $1`, revoked["id"]); err != nil {
		t.Fatal(err)
	}
	if again := d.documentTitled("revoked"); again["error_code"] != nil {
		t.Fatalf("a ready document carries a stale code: %v", again)
	}
	// Any other failure keeps its plain sentence and no code.
	if _, err := d.pool.Exec(ctx, `UPDATE documents SET error = 'the uploaded file is no longer available' WHERE id = $1`,
		removed["id"]); err != nil {
		t.Fatal(err)
	}
	if other := d.documentTitled("removed"); other["error_code"] != nil {
		t.Fatalf("a failure that is no Drive reason carries a code: %v", other)
	}
}

// documentTitled is the knowledge base's one document whose title starts so.
func (d *driveE2E) documentTitled(prefix string) map[string]any {
	d.t.Helper()
	for _, raw := range d.json(http.MethodGet, "/v1/kb/"+d.kb+"/documents", nil, http.StatusOK)["documents"].([]any) {
		doc := raw.(map[string]any)
		if title, _ := doc["title"].(string); strings.HasPrefix(title, prefix) {
			return doc
		}
	}
	d.t.Fatalf("no document titled %s…", prefix)
	return nil
}

// lockedBuffer is a log sink the handlers' goroutines and the test share.
type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// No Drive credential reaches a log line, an answer or a row, through every
// way Drive can fail: a resumed upload, an upload whose every chunk is cut,
// a 500 that echoes the Authorization header, a 401 that forces a refresh,
// a Drive that fills up part way, and a revoked grant.
//
// The log is captured WITHOUT the redacting handler production wraps it in
// (logging.NewRedactingHandler), so this proves the call sites themselves
// never log a credential; the handler is the second line.
func TestDriveCredentialsReachNoLogNoAnswerAndNoRow(t *testing.T) {
	logs := &lockedBuffer{}
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })

	d := newDriveE2E(t)
	ctx := context.Background()
	var mu sync.Mutex
	sessions := map[string]bool{}
	d.fake.Configure(func(o *drivetest.Options) {
		o.Requests = func(r *http.Request) {
			if id := r.URL.Query().Get("upload_id"); id != "" {
				mu.Lock()
				sessions[id] = true
				mu.Unlock()
			}
		}
	})
	var answers []string
	send := func(what, method, path string, body *bytes.Buffer, contentType string) int {
		t.Helper()
		var res *http.Response
		var raw []byte
		if body == nil {
			res, raw = d.send(d.user, method, path, nil, contentType, nil)
		} else {
			res, raw = d.send(d.user, method, path, body, contentType, nil)
		}
		answers = append(answers, what+": "+string(raw))
		return res.StatusCode
	}
	upload := func(what, name string, data []byte) int {
		var buf bytes.Buffer
		w := multipart.NewWriter(&buf)
		part, _ := w.CreateFormFile("file", name)
		_, _ = part.Write(data)
		_ = w.Close()
		return send(what, http.MethodPost, "/v1/kb/"+d.kb+"/documents", &buf, w.FormDataContentType())
	}
	ws := d.json(http.MethodPost, "/v1/reading/workspaces", map[string]any{"document_id": d.doc}, http.StatusOK)["id"].(string)
	view := func(what string) int {
		if err := d.cache.DeleteUser(d.user); err != nil {
			t.Fatal(err)
		}
		return send(what, http.MethodGet, "/v1/reading/"+ws+"/file", nil, "")
	}
	// Three chunks each, so a session URL is used more than once.
	big := func(seed string) []byte {
		return bytes.Repeat([]byte(seed+" retrieval augmented generation keeps its sources.\n"), 3*drivetest.ChunkUnit/48)
	}

	// 1. A chunk cut part way: probed and resumed on the same session.
	cut := d.fake.Stats().Chunks + 2
	d.fake.Configure(func(o *drivetest.Options) { o.CutChunks = map[int]bool{cut: true} })
	if status := upload("resumed upload", "resumed.txt", big("resumed")); status != http.StatusAccepted {
		t.Fatalf("a resumed upload answered %d", status)
	}
	if d.fake.Stats().Probes == 0 {
		t.Fatal("the cut chunk was not probed and resumed")
	}

	// 2. Every chunk cut: the upload gives up, naming no session.
	from := d.fake.Stats().Chunks + 1
	d.fake.Configure(func(o *drivetest.Options) {
		o.CutChunks = map[int]bool{}
		for i := from; i < from+64; i++ {
			o.CutChunks[i] = true
		}
	})
	if status := upload("abandoned upload", "abandoned.txt", big("abandoned")); status < 400 {
		t.Fatalf("an upload whose every chunk was cut answered %d", status)
	}
	d.fake.Configure(func(o *drivetest.Options) { o.CutChunks = map[int]bool{} })

	// 3. Google echoes the Authorization header in a 500.
	d.fake.Configure(func(o *drivetest.Options) { o.Echo500 = true })
	if status := view("echoed 500"); status < 500 {
		t.Fatalf("a read Drive answered 500 got %d", status)
	}
	d.fake.Configure(func(o *drivetest.Options) { o.Echo500 = false })

	// 4. A 401 before the token's time: refreshed (the refresh token goes
	// to the token endpoint) and retried.
	d.fake.Configure(func(o *drivetest.Options) { o.Unauthorized = 1 })
	if status := view("refreshed read"); status != http.StatusOK {
		t.Fatalf("a read after one 401 answered %d", status)
	}

	// 5. Drive fills up part way through an upload.
	d.fake.Configure(func(o *drivetest.Options) { o.QuotaOnChunk = true })
	if status := upload("full on a chunk", "full.txt", big("full")); status != http.StatusInsufficientStorage {
		t.Fatalf("an upload into a Drive that filled up answered %d", status)
	}
	d.fake.Configure(func(o *drivetest.Options) { o.QuotaOnChunk = false })

	// 6. The grant is revoked: uploads and reads are refused.
	d.refused.Store(true)
	if _, err := d.pool.Exec(ctx, `UPDATE drive_connections SET expires_at = now() - interval '1 hour' WHERE user_id = $1`, d.user); err != nil {
		t.Fatal(err)
	}
	if status := upload("revoked upload", "revoked.txt", []byte("refused")); status != http.StatusConflict {
		t.Fatalf("an upload with a revoked grant answered %d", status)
	}
	if status := view("revoked read"); status != http.StatusConflict {
		t.Fatalf("a read with a revoked grant answered %d", status)
	}
	d.drainJobs()

	mu.Lock()
	secrets := []string{drivetest.AccessToken, "1//e2e-refresh-SECRET", "SECRET", "upload_id"}
	for id := range sessions {
		secrets = append(secrets, id)
	}
	mu.Unlock()
	if len(secrets) < 6 {
		t.Fatalf("only %d sessions were opened; the test did not exercise uploads", len(secrets)-4)
	}

	// What the server kept: every row of the learner's jobs, documents and
	// Drive tables, as text. The connection's tokens are encrypted at rest.
	var rows []string
	for _, table := range []string{"jobs", "documents", "drive_files", "drive_folders", "drive_connections"} {
		var text string
		if err := d.pool.QueryRow(ctx, fmt.Sprintf(
			`SELECT coalesce(string_agg(row_to_json(x)::text, E'\n'), '') FROM %s x WHERE user_id = $1`, table),
			d.user).Scan(&text); err != nil {
			t.Fatal(err)
		}
		rows = append(rows, table+": "+text)
	}

	log := logs.String()
	if !strings.Contains(log, "drive") {
		t.Fatalf("nothing about Drive was logged, so the log check proves nothing:\n%s", log)
	}
	for _, where := range append(append([]string{"log: " + log}, answers...), rows...) {
		for _, s := range secrets {
			if strings.Contains(where, s) {
				t.Errorf("%q leaked into %.4000s", s, where)
			}
		}
	}
}
