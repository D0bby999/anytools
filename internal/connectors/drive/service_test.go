package drive

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// newTestService wires a Service against the recorder and the in-memory fakes,
// with one connected user whose access token is already valid.
func newTestService(t *testing.T, rec *recorder) (*Service, *memStore, *memImporter, uuid.UUID) {
	t.Helper()
	store := newMemStore()
	imp := newMemImporter()
	user := uuid.New()

	future := time.Now().Add(time.Hour)
	store.conns[user] = &Connection{
		UserID: user, Email: "owner@example.com", Scope: ScopeDriveFile,
		RefreshToken: "1//0g-stored-refresh", AccessToken: "test-access-token",
		ExpiresAt: &future, ConnectedAt: time.Now(),
	}

	svc := NewService(Config{
		Store: store, Importer: imp, Authz: allowAll{},
		OAuth: OAuthConfig{
			ClientID: "id.apps.googleusercontent.com", ClientSecret: "secret",
			TokenURL: rec.URL() + "/token", RevokeURL: rec.URL() + "/revoke",
		},
		BaseURL: rec.URL(),
	})
	return svc, store, imp, user
}

// Picking a FOLDER grants its children as they are at pick time, and each child
// becomes a document. This is the first half of AC2.
func TestImportPicked_ExpandsAFolderAtPickTime(t *testing.T) {
	rec := newRecorder(t,
		step{name: "files.get folder", wantPath: "/files/" + testFolderID,
			body: `{"id":"` + testFolderID + `","name":"AnyTools KB","mimeType":"` + MimeGoogleFolder + `"}`},
		step{name: "files.list page 1", wantPath: "/files", file: "files_list_page1.json"},
		step{name: "files.list page 2", wantPath: "/files", file: "files_list_page2.json"},
		step{name: "export the Doc", wantPath: "/files/1Doc_WeekOne_Notes/export",
			file: "export_doc.md", ctype: "text/markdown",
			check: func(t *testing.T, r *http.Request) { wantQuery(t, r, "mimeType", MimeMarkdown) }},
		step{name: "download the PDF", wantPath: "/files/1Pdf_Attention",
			body: "%PDF-1.7 attention", ctype: "application/pdf",
			check: func(t *testing.T, r *http.Request) { wantQuery(t, r, "alt", "media") }},
		step{name: "export the Sheet", wantPath: "/files/1Sheet_Syllabus/export",
			body: "Week,Topic\n1,Retrieval\n", ctype: "text/csv",
			check: func(t *testing.T, r *http.Request) { wantQuery(t, r, "mimeType", MimeCSV) }},
	)
	defer rec.done()

	svc, store, imp, user := newTestService(t, rec)
	kb := uuid.New()

	report, err := svc.ImportPicked(context.Background(), user, kb, []Picked{{ID: testFolderID, Kind: KindFolder}})
	if err != nil {
		t.Fatalf("ImportPicked: %v", err)
	}
	if report.Imported != 3 || report.Failed != 0 {
		t.Fatalf("imported=%d failed=%d, want 3 and 0 (%+v)", report.Imported, report.Failed, report.Items)
	}

	// The folder itself is a grant too, so "Pick more" and the UI have
	// something to group the children under.
	folder := store.grantFor(testFolderID)
	if folder == nil || folder.Kind != KindFolder {
		t.Fatal("the picked folder must be recorded as a grant")
	}
	for _, id := range []string{"1Doc_WeekOne_Notes", "1Pdf_Attention", "1Sheet_Syllabus"} {
		g := store.grantFor(id)
		if g == nil {
			t.Fatalf("no grant recorded for %s", id)
		}
		if g.ParentFileID != testFolderID {
			t.Errorf("%s: parent = %q, want the picked folder", id, g.ParentFileID)
		}
		if g.DocumentID == nil {
			t.Errorf("%s: grant has no document", id)
		}
	}

	// The Doc went in as Markdown, so it skips the LLM parse entirely; the
	// Sheet became a Markdown table; the PDF kept its own name and bytes.
	byID := map[string]ImportRequest{}
	for _, c := range imp.calls {
		byID[c.ExternalID] = c
	}
	if got := byID["1Doc_WeekOne_Notes"].Filename; !strings.HasSuffix(got, ".md") {
		t.Errorf("a Google Doc must reach the pipeline as Markdown, got %q", got)
	}
	if !strings.Contains(string(byID["1Doc_WeekOne_Notes"].Data), "| Stage | Cost |") {
		t.Error("the Doc's table did not survive the export")
	}
	if got := byID["1Sheet_Syllabus"].Filename; !strings.HasSuffix(got, ".md") {
		t.Errorf("a Sheet must reach the pipeline as Markdown, got %q", got)
	}
	if got := string(byID["1Sheet_Syllabus"].Data); !strings.Contains(got, "| Week | Topic |") {
		t.Errorf("the Sheet should render as a Markdown table, got %q", got)
	}
	if got := byID["1Pdf_Attention"].Filename; got != "attention.pdf" {
		t.Errorf("a binary keeps its own name so the pipeline can detect it, got %q", got)
	}
}

// AC2's own test: edit one Doc, sync, and exactly ONE document re-imports.
func TestSync_ReimportsOnlyTheChangedFile(t *testing.T) {
	rec := newRecorder(t,
		step{name: "changes.list page 1", wantPath: "/changes", file: "changes_page1.json",
			check: func(t *testing.T, r *http.Request) { wantQuery(t, r, "pageToken", "90210") }},
		step{name: "changes.list page 2", wantPath: "/changes", file: "changes_page2.json"},
		step{name: "re-export the edited Doc", wantPath: "/files/1Doc_WeekOne_Notes/export",
			file: "export_doc.md", ctype: "text/markdown"},
	)
	defer rec.done()

	svc, store, imp, user := newTestService(t, rec)
	kb := uuid.New()
	store.states[user] = &SyncState{UserID: user, StartPageToken: "90210"}

	// Two granted files. The Doc's stored modifiedTime is the OLD one, so the
	// change feed's newer timestamp means it changed; the PDF's md5 matches
	// what the feed reports, so it did not.
	seedGrant(t, store, user, kb, "1Doc_WeekOne_Notes", "", "2026-09-10T08:00:00.000Z")
	seedGrant(t, store, user, kb, "1Pdf_Attention", "9a1f2c47b3de5e6f7a8b9c0d1e2f3a4b", "")

	report, err := svc.Sync(context.Background(), user)
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if report.Reimported != 1 {
		t.Fatalf("re-imported %d documents, want exactly 1 (%+v)", report.Reimported, report.Items)
	}
	if got := imp.importedIDs(); len(got) != 1 || got[0] != "1Doc_WeekOne_Notes" {
		t.Fatalf("re-imported %v, want only the edited Doc", got)
	}

	// The PDF's change in the fixture is a REMOVAL, so its grant is marked
	// removed rather than re-imported.
	if g := store.grantFor("1Pdf_Attention"); g == nil || g.State != GrantRemoved {
		t.Errorf("a removed file's grant must say so, got %+v", g)
	}
	// The checkpoint advanced, or the next poll would replay these changes.
	if store.states[user].StartPageToken != "90219" {
		t.Errorf("checkpoint = %q, want 90219", store.states[user].StartPageToken)
	}
}

// A file added to a picked FOLDER after the pick is visible in the change feed
// and is deliberately NOT imported. That is exactly AC2's fallback wording, and
// it is a decision rather than an oversight — nobody has established that this
// app may read that file.
func TestSync_DoesNotAdoptAFileAddedToAPickedFolderLater(t *testing.T) {
	rec := newRecorder(t,
		step{name: "changes.list page 1", wantPath: "/changes", file: "changes_page1.json"},
		step{name: "changes.list page 2", wantPath: "/changes", file: "changes_page2.json"},
	)
	defer rec.done()

	svc, store, imp, user := newTestService(t, rec)
	kb := uuid.New()
	store.states[user] = &SyncState{UserID: user, StartPageToken: "90210"}
	// Only the FOLDER is granted, plus the Doc at its pick-time content.
	if _, err := store.UpsertGrant(context.Background(), Grant{
		UserID: user, KBID: kb, FileID: testFolderID, Kind: KindFolder, Name: "AnyTools KB",
	}); err != nil {
		t.Fatal(err)
	}
	seedGrant(t, store, user, kb, "1Doc_WeekOne_Notes", "", "2026-09-16T09:01:11.000Z")

	report, err := svc.Sync(context.Background(), user)
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if len(imp.calls) != 0 {
		t.Fatalf("nothing should have been imported, got %v", imp.importedIDs())
	}
	if store.grantFor("1Pdf_AddedAfterPick") != nil {
		t.Error("a file added to the folder later must NOT be granted by the sync — that is what Pick more is for")
	}
	if report.Reimported != 0 {
		t.Errorf("re-imported %d, want 0", report.Reimported)
	}
}

// A 410 loses the change history, so every grant is re-checked directly and
// only the ones that actually moved are re-imported.
func TestSync_410RebaselinesAndRechecksEveryGrant(t *testing.T) {
	rec := newRecorder(t,
		step{name: "changes.list 410", wantPath: "/changes", file: "error_410.json", status: http.StatusGone},
		step{name: "getStartPageToken", wantPath: "/changes/startPageToken", file: "start_page_token_fresh.json"},
		// The full pass walks grants in file_id order, so the Doc comes first.
		step{name: "files.get the changed Doc", wantPath: "/files/1Doc_WeekOne_Notes",
			body: `{"id":"1Doc_WeekOne_Notes","name":"Week One Notes","mimeType":"` + MimeGoogleDoc + `",` +
				`"modifiedTime":"2026-09-17T07:00:00.000Z"}`},
		step{name: "re-export the Doc", wantPath: "/files/1Doc_WeekOne_Notes/export",
			file: "export_doc.md", ctype: "text/markdown"},
		step{name: "files.get the unchanged PDF", wantPath: "/files/1Pdf_Attention",
			body: `{"id":"1Pdf_Attention","name":"attention.pdf","mimeType":"application/pdf",` +
				`"md5Checksum":"same-checksum","modifiedTime":"2026-09-02T11:20:45.000Z"}`},
	)
	defer rec.done()

	svc, store, imp, user := newTestService(t, rec)
	kb := uuid.New()
	store.states[user] = &SyncState{UserID: user, StartPageToken: "1"}
	seedGrant(t, store, user, kb, "1Pdf_Attention", "same-checksum", "2026-09-02T11:20:45.000Z")
	seedGrant(t, store, user, kb, "1Doc_WeekOne_Notes", "", "2026-09-10T08:00:00.000Z")

	report, err := svc.Sync(context.Background(), user)
	if err != nil {
		t.Fatalf("a 410 must recover without user action: %v", err)
	}
	if !report.Rebaselined {
		t.Error("the report must say the change history was lost")
	}
	if report.Checked != 2 {
		t.Errorf("checked %d grants, want both", report.Checked)
	}
	if got := imp.importedIDs(); len(got) != 1 || got[0] != "1Doc_WeekOne_Notes" {
		t.Fatalf("re-imported %v, want only the file whose content moved", got)
	}
	st := store.states[user]
	if st.StartPageToken != "104517" {
		t.Errorf("checkpoint = %q, want the fresh token", st.StartPageToken)
	}
	if st.Rebaselines != 1 {
		t.Errorf("rebaselines = %d, want 1 — a connector re-baselining repeatedly has been down", st.Rebaselines)
	}
}

// 403 insufficientFilePermissions means the app has LOST the file. The grant is
// marked re-pick, the sync stops asking, and no re-baseline is triggered.
func TestSync_403MarksTheGrantForRePicking(t *testing.T) {
	rec := newRecorder(t,
		step{name: "changes.list", wantPath: "/changes",
			body: `{"newStartPageToken":"90300","changes":[{"changeType":"file","removed":false,` +
				`"fileId":"1Doc_WeekOne_Notes","file":{"id":"1Doc_WeekOne_Notes","name":"Week One Notes",` +
				`"mimeType":"` + MimeGoogleDoc + `","modifiedTime":"2026-09-17T07:00:00.000Z"}}]}`},
		step{name: "export denied", wantPath: "/files/1Doc_WeekOne_Notes/export",
			file: "error_403_insufficient.json", status: http.StatusForbidden},
	)
	defer rec.done()

	svc, store, _, user := newTestService(t, rec)
	kb := uuid.New()
	store.states[user] = &SyncState{UserID: user, StartPageToken: "90210"}
	seedGrant(t, store, user, kb, "1Doc_WeekOne_Notes", "", "2026-09-10T08:00:00.000Z")

	report, err := svc.Sync(context.Background(), user)
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if report.RePick != 1 {
		t.Fatalf("re-pick count = %d, want 1 (%+v)", report.RePick, report.Items)
	}
	if report.Rebaselined {
		t.Error("a 403 must never trigger a re-baseline — that loop never tells the user anything")
	}
	g := store.grantFor("1Doc_WeekOne_Notes")
	if g == nil || g.State != GrantRePick {
		t.Fatalf("grant state = %+v, want re-pick", g)
	}
	if !strings.Contains(g.LastError, "Pick it again") {
		t.Errorf("the reason must tell the user what to do, got %q", g.LastError)
	}
	// And it is out of the active set, so the next sync does not ask again.
	active, _ := store.ListActiveFileGrants(context.Background(), user)
	if len(active) != 0 {
		t.Errorf("a re-pick grant must leave the active set, got %d", len(active))
	}
}

// A first sync with no stored token baselines and reports nothing. Reporting
// "0 changes" without saying so would read as "nothing happened in your Drive",
// which is a different and false claim.
func TestSync_FirstRunBaselinesWithoutImporting(t *testing.T) {
	rec := newRecorder(t, step{name: "getStartPageToken", wantPath: "/changes/startPageToken",
		file: "start_page_token.json"})
	defer rec.done()

	svc, store, imp, user := newTestService(t, rec)
	report, err := svc.Sync(context.Background(), user)
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if !report.Baselined {
		t.Error("the first run must report that it only baselined")
	}
	if len(imp.calls) != 0 {
		t.Error("a baseline must import nothing — the grants were imported when they were picked")
	}
	if store.states[user].StartPageToken != "90210" {
		t.Error("the baseline token must be stored")
	}
}

// A failed poll must NOT advance the checkpoint: the changes between the stored
// token and the failure are only ever offered once.
func TestSync_AFailedPollKeepsTheCheckpointWhereItIs(t *testing.T) {
	rec := newRecorder(t, step{name: "changes.list fails", wantPath: "/changes",
		body:   `{"error":{"code":503,"message":"Backend Error","errors":[{"reason":"backendError"}]}}`,
		status: http.StatusServiceUnavailable})
	defer rec.done()

	svc, store, _, user := newTestService(t, rec)
	store.states[user] = &SyncState{UserID: user, StartPageToken: "90210"}

	if _, err := svc.Sync(context.Background(), user); err == nil {
		t.Fatal("a failed poll must be reported")
	}
	st := store.states[user]
	if st.StartPageToken != "90210" {
		t.Fatalf("checkpoint moved to %q on a failure — those changes are gone forever", st.StartPageToken)
	}
	if st.LastError == "" {
		t.Error("the failure must be recorded so readiness can show it")
	}
}

// An expired access token refreshes underneath the call, and the new one is
// stored so the next call does not refresh again.
func TestAccessToken_RefreshesWhenExpired(t *testing.T) {
	rec := newRecorder(t,
		step{name: "token refresh", wantPath: "/token",
			body: `{"access_token":"ya29.fresh","token_type":"Bearer","expires_in":3599,"scope":"` + ScopeDriveFile + `"}`},
	)
	defer rec.done()

	svc, store, _, user := newTestService(t, rec)
	past := time.Now().Add(-time.Hour)
	store.conns[user].ExpiresAt = &past

	tok, err := svc.accessToken(context.Background(), user)
	if err != nil {
		t.Fatalf("accessToken: %v", err)
	}
	if tok != "ya29.fresh" {
		t.Errorf("token = %q, want the refreshed one", tok)
	}
	if store.conns[user].AccessToken != "ya29.fresh" {
		t.Error("the refreshed token must be stored, or every call refreshes again")
	}
	// The refresh token is untouched: Google does not mint a new one here, and
	// blanking it would disconnect the account an hour later.
	if store.conns[user].RefreshToken != "1//0g-stored-refresh" {
		t.Error("the refresh token must survive a refresh")
	}
}

// An invalid_grant is the one failure that tells the user to reconnect.
func TestAccessToken_InvalidGrantMarksTheConnection(t *testing.T) {
	rec := newRecorder(t, step{name: "refresh rejected", wantPath: "/token",
		body:   `{"error":"invalid_grant","error_description":"Token has been expired or revoked."}`,
		status: http.StatusBadRequest})
	defer rec.done()

	svc, store, _, user := newTestService(t, rec)
	past := time.Now().Add(-time.Hour)
	store.conns[user].ExpiresAt = &past

	_, err := svc.accessToken(context.Background(), user)
	if !errors.Is(err, ErrNeedsReconnect) {
		t.Fatalf("error = %v, want ErrNeedsReconnect", err)
	}
	if !store.conns[user].NeedsReconnect {
		t.Fatal("the connection must be marked, or readiness never says why syncing stopped")
	}

	status, reason := mustStatus(t, svc, user).ReadinessLine()
	if status != "blocked" || reason != "Drive: reconnect needed." {
		t.Errorf("readiness = %s/%q, want the plan's exact sentence", status, reason)
	}
}

// A transient upstream failure must NOT disconnect a working account.
func TestAccessToken_ATransientFailureLeavesTheConnectionAlone(t *testing.T) {
	rec := newRecorder(t, step{name: "refresh 503", wantPath: "/token",
		body: `{"error":"internal_failure"}`, status: http.StatusServiceUnavailable})
	defer rec.done()

	svc, store, _, user := newTestService(t, rec)
	past := time.Now().Add(-time.Hour)
	store.conns[user].ExpiresAt = &past

	_, err := svc.accessToken(context.Background(), user)
	if err == nil {
		t.Fatal("a failed refresh must be reported")
	}
	if errors.Is(err, ErrNeedsReconnect) || store.conns[user].NeedsReconnect {
		t.Fatal("one bad minute at Google must not tell every user to reconnect")
	}
}

// Ownership is checked BEFORE anything is fetched or written.
func TestImportPicked_RefusesAKnowledgeBaseTheUserDoesNotOwn(t *testing.T) {
	rec := newRecorder(t)
	defer rec.done() // no Drive call may be made at all

	svc, _, imp, user := newTestService(t, rec)
	denied := errors.New("authz: no access")
	svc.authz = denyAll{err: denied}

	_, err := svc.ImportPicked(context.Background(), user, uuid.New(), []Picked{{ID: "x", Kind: KindFile}})
	if !errors.Is(err, denied) {
		t.Fatalf("error = %v, want the authorizer's refusal", err)
	}
	if len(imp.calls) != 0 {
		t.Fatal("nothing may be imported into a knowledge base the user does not own")
	}
}

// Disconnect revokes at Google, then forgets locally.
func TestDisconnect_RevokesAtGoogleThenForgets(t *testing.T) {
	rec := newRecorder(t, step{name: "revoke", wantPath: "/revoke", body: "{}",
		check: func(t *testing.T, r *http.Request) {
			if got := formOf(t, r).Get("token"); got != "1//0g-stored-refresh" {
				t.Errorf("revoked %q", got)
			}
		}})
	defer rec.done()

	svc, store, _, user := newTestService(t, rec)
	if err := svc.Disconnect(context.Background(), user); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}
	if _, ok := store.conns[user]; ok {
		t.Error("the local grant must be gone")
	}
}

// A revoke that fails must NOT block the disconnect: the user has decided, and
// a button that does nothing because Google blipped is worse than a stale token
// the user can clear from their Google account page.
func TestDisconnect_SurvivesAFailedRevoke(t *testing.T) {
	rec := newRecorder(t, step{name: "revoke fails", wantPath: "/revoke",
		body: `{"error":"server_error"}`, status: http.StatusInternalServerError})
	defer rec.done()

	svc, store, _, user := newTestService(t, rec)
	if err := svc.Disconnect(context.Background(), user); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}
	if _, ok := store.conns[user]; ok {
		t.Error("the local grant must be gone even when Google could not be reached")
	}
}

// Connect refuses a grant with no refresh token, because that connector works
// for an hour and then fails with a 401 nobody can interpret.
func TestConnect_RequiresARefreshToken(t *testing.T) {
	rec := newRecorder(t)
	defer rec.done()

	svc, _, _, _ := newTestService(t, rec)
	err := svc.Connect(context.Background(), uuid.New(), Credentials{AccessToken: "ya29.x"})
	if err == nil || !strings.Contains(err.Error(), "refresh token") {
		t.Fatalf("error = %v, want a refusal naming the refresh token", err)
	}
}

func TestConnect_RefusesAGrantThatIsNotDriveFile(t *testing.T) {
	rec := newRecorder(t)
	defer rec.done()

	svc, _, _, _ := newTestService(t, rec)
	err := svc.Connect(context.Background(), uuid.New(), Credentials{
		RefreshToken: "1//0g-x", Scope: "https://www.googleapis.com/auth/userinfo.email",
	})
	if err == nil || !strings.Contains(err.Error(), ScopeDriveFile) {
		t.Fatalf("error = %v, want a refusal naming the required scope", err)
	}
}

func seedGrant(t *testing.T, store *memStore, user, kb uuid.UUID, fileID, md5, modified string) {
	t.Helper()
	g, err := store.UpsertGrant(context.Background(), Grant{
		UserID: user, KBID: kb, FileID: fileID, Kind: KindFile, Name: fileID, State: GrantActive,
	})
	if err != nil {
		t.Fatalf("seed grant: %v", err)
	}
	if err := store.RecordGrantSynced(context.Background(), user, g.ID, uuid.New(), md5, modified); err != nil {
		t.Fatalf("seed grant sync: %v", err)
	}
}

func mustStatus(t *testing.T, svc *Service, user uuid.UUID) *Status {
	t.Helper()
	st, err := svc.Status(context.Background(), user)
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	return st
}
