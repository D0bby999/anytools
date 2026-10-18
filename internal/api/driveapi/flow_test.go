package driveapi_test

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/connectors/drive"
)

// TestPickFolderImportEditSyncRebaselineRepick is the phase's whole promise in
// one run, at HTTP level, in the order a user would meet it:
//
//	pick a folder → its children are granted → documents exist
//	→ edit ONE Doc in Drive → Sync now → exactly one document re-imports
//	→ the change token goes stale → the next sync re-baselines by itself
//	→ Google revokes one file → that grant is marked "re-pick"
//
// It is one test rather than six because the states are sequential: a
// re-baseline only means something after a checkpoint exists, and a re-pick
// only means something after a grant does.
func TestPickFolderImportEditSyncRebaselineRepick(t *testing.T) {
	e := newEnv(t)
	folderID := e.seedFolder()
	e.connect(e.alice)
	kb := e.createKB(e.alice, "Drive course")

	// ── pick a folder ───────────────────────────────────────────────────────
	rec := e.do(e.alice, http.MethodPost, "/v1/kb/"+kb.String()+"/drive/import", map[string]any{
		"picked": []map[string]string{{"id": folderID, "kind": "folder"}},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	var report drive.ImportReport
	decode(t, rec, &report)
	if report.Imported != 2 || report.Failed != 0 {
		t.Fatalf("imported=%d failed=%d, want 2 and 0 (%+v)", report.Imported, report.Failed, report.Items)
	}

	// The folder AND each child it contributed are granted. Under drive.file
	// this list is not a cache — it is the whole of what the app may read.
	grants := e.grants(e.alice, kb)
	if g, ok := grants[folderID]; !ok || g.Kind != drive.KindFolder {
		t.Fatalf("the picked folder is not granted: %+v", grants)
	}
	for _, id := range []string{"doc-notes", "md-syllabus"} {
		g, ok := grants[id]
		if !ok {
			t.Fatalf("%s was not granted", id)
		}
		if g.ParentFileID != folderID {
			t.Errorf("%s: parent = %q, want the picked folder", id, g.ParentFileID)
		}
		if g.State != drive.GrantActive || g.DocumentID == nil {
			t.Errorf("%s: grant = %+v, want active with a document", id, g)
		}
	}

	// ── documents exist ─────────────────────────────────────────────────────
	docs := e.documents(e.alice, kb)
	if len(docs) != 2 {
		t.Fatalf("documents = %+v, want one per granted file", docs)
	}
	// The Doc was exported to Markdown, so its title carries .md and no model
	// was needed to read it.
	if title := docs["doc-notes"].Title; !strings.HasSuffix(title, ".md") {
		t.Errorf("a Google Doc should arrive as Markdown, got title %q", title)
	}
	for id, d := range docs {
		if d.Version != 1 || d.Status != "queued" {
			t.Errorf("%s: version=%d status=%s, want a fresh queued document", id, d.Version, d.Status)
		}
	}

	// The first sync only baselines: it has no history to compare against, and
	// the grants were already imported at pick time.
	if first := e.sync(e.alice); !first.Baselined || first.Reimported != 0 {
		t.Fatalf("first sync = %+v, want a baseline that imports nothing", first)
	}

	// ── edit ONE Doc, then sync ─────────────────────────────────────────────
	e.google.edit("doc-notes", "# Week 1\n\nRetrieval beats generation. Now with a table.\n",
		"2026-09-17T09:30:00.000Z")

	report2 := e.sync(e.alice)
	if report2.Reimported != 1 {
		t.Fatalf("re-imported %d documents, want exactly 1 (%+v)", report2.Reimported, report2.Items)
	}

	after := e.documents(e.alice, kb)
	if after["doc-notes"].Version != 2 {
		t.Errorf("the edited Doc should be at version 2, got %d", after["doc-notes"].Version)
	}
	if after["doc-notes"].ID != docs["doc-notes"].ID {
		t.Error("a re-import must be a new VERSION of the same document, not a second one")
	}
	// The untouched file must not have been re-parsed: that would spend the
	// user's parse and embed quota on identical bytes, every quarter hour.
	if after["md-syllabus"].Version != 1 {
		t.Errorf("the unchanged file was re-imported (version %d)", after["md-syllabus"].Version)
	}
	if len(after) != 2 {
		t.Errorf("a re-import created a document instead of re-versioning one: %+v", after)
	}

	// ── the change token goes stale ─────────────────────────────────────────
	e.google.mu.Lock()
	e.google.gone = true
	e.google.mu.Unlock()

	before := e.google.callCount()
	report3 := e.sync(e.alice)
	if !report3.Rebaselined {
		t.Fatalf("a 410 must re-baseline without user action, got %+v", report3)
	}
	if report3.Checked != 2 {
		t.Errorf("after a re-baseline every grant must be re-checked, checked %d", report3.Checked)
	}
	calls := e.google.callsSince(before)
	if !contains(calls, "getStartPageToken") {
		t.Errorf("the recovery must fetch a fresh token, calls were %v", calls)
	}
	// Nothing changed in Drive since the last poll, so the full pass re-imports
	// nothing — a re-baseline is not an excuse to re-parse the world.
	if report3.Reimported != 0 {
		t.Errorf("the re-baseline re-imported %d documents, want 0", report3.Reimported)
	}

	// ── Google revokes one file ─────────────────────────────────────────────
	e.google.mu.Lock()
	e.google.forbid["doc-notes"] = true
	e.google.mu.Unlock()
	e.google.edit("md-syllabus", "# Syllabus\n\nWeek 1: retrieval. Week 2: ranking.\n", "2026-09-17T10:00:00.000Z")
	e.google.mu.Lock()
	e.google.changes = append(e.google.changes, map[string]any{
		"changeType": "file", "removed": false, "fileId": "doc-notes",
		"file": map[string]any{
			"id": "doc-notes", "name": "Week One Notes", "mimeType": drive.MimeGoogleDoc,
			"modifiedTime": "2026-09-17T11:00:00.000Z",
		},
	})
	e.google.mu.Unlock()

	report4 := e.sync(e.alice)
	if report4.RePick != 1 {
		t.Fatalf("re-pick count = %d, want 1 (%+v)", report4.RePick, report4.Items)
	}
	if report4.Rebaselined {
		t.Error("a 403 must never be mistaken for a stale token — that loop never tells the user anything")
	}
	if report4.Reimported != 1 {
		t.Errorf("the still-readable file should have re-imported, got %d", report4.Reimported)
	}

	grantsAfter := e.grants(e.alice, kb)
	if g := grantsAfter["doc-notes"]; g.State != drive.GrantRePick {
		t.Fatalf("grant state = %q, want %q", g.State, drive.GrantRePick)
	}
	if msg := grantsAfter["doc-notes"].LastError; !strings.Contains(msg, "Pick it again") {
		t.Errorf("the reason must tell the user what to do, got %q", msg)
	}

	// ── and the status endpoint says all of it ──────────────────────────────
	var status drive.Status
	decode(t, e.do(e.alice, http.MethodGet, "/v1/connectors/drive/status", nil), &status)
	if !status.Connected || status.RePick != 1 {
		t.Fatalf("status = %+v, want connected with one file to re-pick", status)
	}
	if _, reason := status.ReadinessLine(); !strings.Contains(reason, "re-pick") {
		t.Errorf("readiness should surface the re-pick, got %q", reason)
	}
}

// "Pick more" is AC2's other half: a file that landed in the folder after the
// pick is added by picking it, and the grant that had been marked re-pick
// recovers the same way.
func TestPickMoreAddsALaterFileAndClearsARePick(t *testing.T) {
	e := newEnv(t)
	folderID := e.seedFolder()
	e.connect(e.alice)
	kb := e.createKB(e.alice, "Drive course")

	e.importPicked(e.alice, kb, drive.Picked{ID: folderID, Kind: drive.KindFolder})

	// Someone drops a new file into the folder afterwards. The sync must NOT
	// adopt it — under drive.file nobody has established the app may read it.
	e.google.add(folderID, &driveFile{
		ID: "md-late", Name: "late.md", MimeType: "text/markdown", MD5: "bbb222",
		Modified: "2026-09-17T12:00:00.000Z", Content: []byte("# Added later\n"),
	})
	e.sync(e.alice) // baseline
	if _, ok := e.grants(e.alice, kb)["md-late"]; ok {
		t.Fatal("a later file must not be adopted by the sync — that is what Pick more is for")
	}

	// Pick more: the user hands the app that file explicitly.
	e.importPicked(e.alice, kb, drive.Picked{ID: "md-late", Kind: drive.KindFile})
	g, ok := e.grants(e.alice, kb)["md-late"]
	if !ok || g.State != drive.GrantActive || g.DocumentID == nil {
		t.Fatalf("Pick more did not grant the file: %+v", g)
	}
	if _, ok := e.documents(e.alice, kb)["md-late"]; !ok {
		t.Fatal("Pick more did not create the document")
	}
}

// Every id route is cross-user isolated, and a knowledge base someone else owns
// is answered 404 — never 403, which would confirm it exists.
func TestCrossUserIsolationOnEveryIDRoute(t *testing.T) {
	e := newEnv(t)
	folderID := e.seedFolder()
	e.connect(e.alice)
	e.connect(e.bob)
	kb := e.createKB(e.alice, "Alice's KB")
	e.importPicked(e.alice, kb, drive.Picked{ID: folderID, Kind: drive.KindFolder})

	for _, route := range []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, "/v1/kb/" + kb.String() + "/drive/grants", nil},
		{http.MethodPost, "/v1/kb/" + kb.String() + "/drive/import",
			map[string]any{"picked": []map[string]string{{"id": folderID, "kind": "folder"}}}},
	} {
		rec := e.do(e.bob, route.method, route.path, route.body)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s %s as another user: %d %s, want 404",
				route.method, route.path, rec.Code, rec.Body.String())
		}
	}

	// Bob's own sync must not touch Alice's grants, however the change feed
	// happens to answer.
	if report := e.sync(e.bob); report.Checked != 0 || report.Reimported != 0 {
		t.Errorf("bob's sync saw alice's grants: %+v", report)
	}

	// And Alice's documents are untouched by any of it.
	if len(e.documents(e.alice, kb)) != 2 {
		t.Error("alice's documents changed")
	}
	if len(e.documents(e.bob, kb)) != 0 {
		t.Error("bob can see documents in a knowledge base he does not own")
	}
}

// Disconnect revokes at Google and takes the grants with it — a grant is a
// record of permission the app no longer has. The DOCUMENTS stay: they are the
// user's, already parsed and cited.
func TestDisconnectForgetsTheGrantsButKeepsTheDocuments(t *testing.T) {
	e := newEnv(t)
	folderID := e.seedFolder()
	e.connect(e.alice)
	kb := e.createKB(e.alice, "Drive course")
	e.importPicked(e.alice, kb, drive.Picked{ID: folderID, Kind: drive.KindFolder})

	rec := e.do(e.alice, http.MethodDelete, "/v1/connectors/drive", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("disconnect: %d %s", rec.Code, rec.Body.String())
	}

	var status drive.Status
	decode(t, e.do(e.alice, http.MethodGet, "/v1/connectors/drive/status", nil), &status)
	if status.Connected || status.Grants != 0 {
		t.Fatalf("status after disconnect = %+v", status)
	}
	if len(e.documents(e.alice, kb)) != 2 {
		t.Error("disconnecting a source must not delete the documents it produced")
	}

	// And an import now refuses with a code the UI can turn into "connect Drive
	// first", rather than a 500.
	rec = e.do(e.alice, http.MethodPost, "/v1/kb/"+kb.String()+"/drive/import", map[string]any{
		"picked": []map[string]string{{"id": folderID, "kind": "folder"}},
	})
	if rec.Code != http.StatusConflict {
		t.Fatalf("import without a connection: %d %s, want 409", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "not_connected") {
		t.Errorf("the refusal must carry a code the UI can act on, got %s", rec.Body.String())
	}
}

// The credentials endpoint stores the refresh token ENCRYPTED. A row that
// carried it in the clear would be the worst row in this database.
func TestCredentialsAreStoredEncrypted(t *testing.T) {
	e := newEnv(t)
	e.connect(e.alice)

	var refreshEnc, accessEnc string
	err := e.pool.QueryRow(context.Background(),
		`SELECT refresh_enc, access_enc FROM drive_connections WHERE user_id = $1`, e.alice).
		Scan(&refreshEnc, &accessEnc)
	if err != nil {
		t.Fatalf("read connection: %v", err)
	}
	plaintext := "1//0g-" + e.alice.String()
	if refreshEnc == plaintext || strings.Contains(refreshEnc, "1//0g-") {
		t.Fatal("the refresh token is stored in the clear")
	}
	if strings.Contains(accessEnc, "ya29.") {
		t.Fatal("the access token is stored in the clear")
	}
	// And it round-trips: an unreadable token would be a connector that fails
	// on its first sync with a decrypt error.
	if refreshEnc == "" {
		t.Fatal("no refresh token was stored at all")
	}
}

// A credentials post with no refresh token is refused, with the sentence that
// tells the user what to do.
func TestCredentialsWithoutARefreshTokenAreRefused(t *testing.T) {
	e := newEnv(t)
	rec := e.do(e.alice, http.MethodPost, "/v1/connectors/drive/credentials", map[string]any{
		"access_token": "ya29.only", "scope": drive.ScopeDriveFile,
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "refresh token") {
		t.Errorf("the refusal must name the problem, got %s", rec.Body.String())
	}
}

// Every connector route sits behind the auth chokepoint like the rest of the
// API. This is the structural claim httpx.AllowlistedPaths exists to protect.
func TestConnectorRoutesRequireAuthentication(t *testing.T) {
	e := newEnv(t)
	for _, path := range []string{
		"/v1/connectors/drive/status",
		"/v1/connectors/drive/sync",
		"/v1/connectors/drive",
	} {
		rec := e.do(uuid.Nil, http.MethodGet, path, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s without a user: %d, want 401", path, rec.Code)
		}
	}
	if rec := e.do(uuid.Nil, http.MethodPost, "/v1/connectors/drive/picker-token", nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("picker-token without a user: %d, want 401", rec.Code)
	}
}

// The Picker needs an access token in the browser, and the web half gets it
// here. What comes back is the ACCESS token only: the refresh token is the one
// credential that must never leave the API, and an unconnected user is told so
// with a code the UI can act on rather than a 500.
func TestPickerTokenHandsOutTheAccessTokenOnly(t *testing.T) {
	e := newEnv(t)

	rec := e.do(e.alice, http.MethodPost, "/v1/connectors/drive/picker-token", nil)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "not_connected") {
		t.Fatalf("picker-token before connecting: %d %s, want 409 not_connected", rec.Code, rec.Body.String())
	}

	e.connect(e.alice)
	rec = e.do(e.alice, http.MethodPost, "/v1/connectors/drive/picker-token", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("picker-token: %d %s", rec.Code, rec.Body.String())
	}
	var body map[string]string
	decode(t, rec, &body)
	if body["access_token"] != "ya29.initial" {
		t.Errorf("access_token = %q, want the stored, still-valid token", body["access_token"])
	}
	if strings.Contains(rec.Body.String(), "1//0g-") || len(body) != 1 {
		t.Fatalf("the response carries more than the access token: keys=%d", len(body))
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Error("a credential must be answered with Cache-Control: no-store")
	}

	// Bob is not connected, and Alice's token is not his to borrow.
	if rec := e.do(e.bob, http.MethodPost, "/v1/connectors/drive/picker-token", nil); rec.Code != http.StatusConflict {
		t.Errorf("picker-token as an unconnected user: %d, want 409", rec.Code)
	}
}

func (e *env) importPicked(user, kb uuid.UUID, picked ...drive.Picked) drive.ImportReport {
	e.t.Helper()
	items := make([]map[string]string, len(picked))
	for i, p := range picked {
		items[i] = map[string]string{"id": p.ID, "kind": p.Kind}
	}
	rec := e.do(user, http.MethodPost, "/v1/kb/"+kb.String()+"/drive/import",
		map[string]any{"picked": items})
	if rec.Code != http.StatusOK {
		e.t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	var report drive.ImportReport
	decode(e.t, rec, &report)
	return report
}

func contains(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}
