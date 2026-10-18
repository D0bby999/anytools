package drive

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
)

const testFolderID = "1Folder_AnyTools_KB"

// wantFolderQuery is the exact `q` this connector sends. Asserted literally
// because a wrong operator ("in parents" vs "= parents") or a missing
// `trashed = false` is a silent wrong-answer bug, not a compile error.
const wantFolderQuery = `'` + testFolderID + `' in parents and trashed = false`

// Capability row 1 — list a picked folder's children, with paging.
func TestListFolderChildren_PagesAndSendsTheRightQuery(t *testing.T) {
	const page1Token = "~!!~AI9FV7QT8xN2fZ0pYb3kQ1sV"

	rec := newRecorder(t,
		step{
			name: "files.list page 1", wantPath: "/files", file: "files_list_page1.json",
			check: func(t *testing.T, r *http.Request) {
				wantAuthorized(t, r)
				wantQuery(t, r, "q", wantFolderQuery)
				wantQuery(t, r, "pageSize", "100")
				if tok := r.URL.Query().Get("pageToken"); tok != "" {
					t.Errorf("first page must not carry a pageToken, got %q", tok)
				}
				// Change detection needs both: md5Checksum for binaries,
				// modifiedTime for Google-native docs that have no md5.
				for _, f := range []string{"md5Checksum", "modifiedTime", "mimeType"} {
					if !strings.Contains(r.URL.Query().Get("fields"), f) {
						t.Errorf("fields is missing %q: %q", f, r.URL.Query().Get("fields"))
					}
				}
			},
		},
		step{
			name: "files.list page 2", wantPath: "/files", file: "files_list_page2.json",
			check: func(t *testing.T, r *http.Request) {
				wantQuery(t, r, "pageToken", page1Token)
				wantQuery(t, r, "q", wantFolderQuery)
			},
		},
	)
	defer rec.done()

	files, err := testClient(rec).ListFolderChildren(context.Background(), testFolderID)
	if err != nil {
		t.Fatalf("ListFolderChildren: %v", err)
	}
	gotIDs := ids(files)
	wantIDs := []string{"1Doc_WeekOne_Notes", "1Pdf_Attention", "1Sheet_Syllabus"}
	if !equal(gotIDs, wantIDs) {
		t.Fatalf("children = %v, want %v (both pages, in order)", gotIDs, wantIDs)
	}

	// A Google Doc carries no md5Checksum. fileChanged must not compare md5 for
	// native types, or every Doc looks changed on every poll.
	byID := index(files)
	if byID["1Doc_WeekOne_Notes"].MD5Checksum != "" {
		t.Error("a Google Doc should have no md5Checksum in Drive's response")
	}
	if byID["1Pdf_Attention"].MD5Checksum == "" {
		t.Error("a binary file should carry md5Checksum")
	}
	if byID["1Doc_WeekOne_Notes"].ModifiedTime == "" {
		t.Error("modifiedTime is the only change signal available for a Doc")
	}
}

// Capability row 2, SUPPORTED branch — the same folder listing after a file was
// added to it. Only a live consented run can say whether Google answers this
// way under drive.file; this proves the CODE handles it, not that the scope
// allows it. AC2 ships in its fallback wording until that run happens.
func TestListFolderChildren_SeesFileAddedAfterThePick(t *testing.T) {
	rec := newRecorder(t, step{
		name:     "files.list after a new file landed in the folder",
		wantPath: "/files", file: "files_list_after_add.json",
		check: func(t *testing.T, r *http.Request) { wantQuery(t, r, "q", wantFolderQuery) },
	})
	defer rec.done()

	files, err := testClient(rec).ListFolderChildren(context.Background(), testFolderID)
	if err != nil {
		t.Fatalf("ListFolderChildren: %v", err)
	}
	if _, ok := index(files)["1Pdf_AddedAfterPick"]; !ok {
		t.Fatalf("the later-added file is missing from %v", ids(files))
	}
	if len(files) != 4 {
		t.Fatalf("got %d children, want 4", len(files))
	}
}

// Capability row 2, UNSUPPORTED branch — drive.file refuses a file the user
// never handed to the app. It must classify as a permission denial and NOT as
// a stale page token: mistaking the two makes the connector re-baseline the
// change feed forever instead of telling the user to pick again.
func TestListFolderChildren_PermissionDeniedIsNotATokenProblem(t *testing.T) {
	rec := newRecorder(t, step{
		name: "files.list denied", wantPath: "/files",
		file: "error_403_insufficient.json", status: http.StatusForbidden,
	})
	defer rec.done()

	_, err := testClient(rec).ListFolderChildren(context.Background(), testFolderID)
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("error = %v, want *APIError", err)
	}
	if !apiErr.Forbidden() {
		t.Error("403 insufficientFilePermissions must classify as Forbidden")
	}
	if apiErr.Gone() {
		t.Error("403 must NOT classify as Gone — that would trigger a pointless re-baseline")
	}
	if apiErr.Reason != "insufficientFilePermissions" {
		t.Errorf("Reason = %q, want insufficientFilePermissions", apiErr.Reason)
	}
	if !IsForbidden(err) {
		t.Error("IsForbidden must recognise a wrapped denial — it is what marks a grant re-pick")
	}
}

// Capability rows 2 and 3 — changes.list surfaces both an edit to a picked Doc
// and the arrival of a new file, across two pages, ending on newStartPageToken.
func TestSyncChanges_SurfacesDocEditAndNewFileAndCheckpoints(t *testing.T) {
	rec := newRecorder(t,
		step{
			name: "changes.list page 1", wantPath: "/changes", file: "changes_page1.json",
			check: func(t *testing.T, r *http.Request) {
				wantAuthorized(t, r)
				wantQuery(t, r, "pageToken", "90210")
				// Without includeRemoved a trashed grant never reaches the sync
				// job and the document stays indexed forever.
				wantQuery(t, r, "includeRemoved", "true")
			},
		},
		step{
			name: "changes.list page 2", wantPath: "/changes", file: "changes_page2.json",
			check: func(t *testing.T, r *http.Request) { wantQuery(t, r, "pageToken", "90213") },
		},
	)
	defer rec.done()

	res, err := testClient(rec).SyncChanges(context.Background(), "90210")
	if err != nil {
		t.Fatalf("SyncChanges: %v", err)
	}
	if res.Rebaselined {
		t.Error("a healthy sync must not report a re-baseline")
	}
	if res.NextToken != "90219" {
		t.Errorf("NextToken = %q, want the final page's newStartPageToken 90219", res.NextToken)
	}
	if len(res.Changes) != 3 {
		t.Fatalf("got %d changes, want 3", len(res.Changes))
	}

	byFile := map[string]Change{}
	for _, c := range res.Changes {
		byFile[c.FileID] = c
	}
	edit, ok := byFile["1Doc_WeekOne_Notes"]
	if !ok {
		t.Fatal("the edit to the picked Doc is missing (capability row 3)")
	}
	if edit.File == nil || edit.File.ModifiedTime != "2026-09-16T09:01:11.000Z" {
		t.Error("the Doc change must carry the new modifiedTime so only that document re-indexes")
	}
	if _, ok := byFile["1Pdf_AddedAfterPick"]; !ok {
		t.Fatal("the file added to the folder after the pick is missing (capability row 2)")
	}
	removal, ok := byFile["1Pdf_Attention"]
	if !ok || !removal.Removed {
		t.Error("the removal change must be parsed with Removed=true and may carry no file object")
	}
}

// Capability row 5 — a stale startPageToken 410s and the client re-baselines
// instead of failing the sync.
func TestSyncChanges_410Rebaselines(t *testing.T) {
	rec := newRecorder(t,
		step{
			name: "changes.list with a stale token", wantPath: "/changes",
			file: "error_410.json", status: http.StatusGone,
			check: func(t *testing.T, r *http.Request) { wantQuery(t, r, "pageToken", "1") },
		},
		step{
			name: "changes.getStartPageToken (re-baseline)", wantPath: "/changes/startPageToken",
			file:  "start_page_token_fresh.json",
			check: func(t *testing.T, r *http.Request) { wantAuthorized(t, r) },
		},
	)
	defer rec.done()

	res, err := testClient(rec).SyncChanges(context.Background(), "1")
	if err != nil {
		t.Fatalf("a 410 must be recovered, not returned: %v", err)
	}
	if !res.Rebaselined {
		t.Error("Rebaselined must be true so the caller knows change history was lost")
	}
	if res.NextToken != "104517" {
		t.Errorf("NextToken = %q, want the fresh token 104517", res.NextToken)
	}
	if len(res.Changes) != 0 {
		t.Errorf("a re-baseline yields no changes, got %d — reporting any would be a lie", len(res.Changes))
	}
}

// The 410 recovery must not paper over a second failure: if the re-baseline
// itself fails there is no valid checkpoint and the caller must hear about it.
func TestSyncChanges_410ThenRebaselineFailureSurfaces(t *testing.T) {
	rec := newRecorder(t,
		step{name: "changes.list 410", wantPath: "/changes", file: "error_410.json", status: http.StatusGone},
		step{name: "getStartPageToken fails", wantPath: "/changes/startPageToken",
			body:   `{"error":{"code":503,"message":"Backend Error","errors":[{"reason":"backendError"}]}}`,
			status: http.StatusServiceUnavailable},
	)
	defer rec.done()

	res, err := testClient(rec).SyncChanges(context.Background(), "1")
	if err == nil {
		t.Fatal("a failed re-baseline must return an error")
	}
	if res.NextToken != "" {
		t.Error("no checkpoint may be handed back when the re-baseline failed")
	}
	if !strings.Contains(err.Error(), "re-baseline after 410") {
		t.Errorf("error should name the failing stage, got %v", err)
	}
}

func TestGetStartPageToken(t *testing.T) {
	rec := newRecorder(t, step{name: "getStartPageToken", wantPath: "/changes/startPageToken", file: "start_page_token.json"})
	defer rec.done()

	tok, err := testClient(rec).GetStartPageToken(context.Background())
	if err != nil {
		t.Fatalf("GetStartPageToken: %v", err)
	}
	if tok != "90210" {
		t.Errorf("token = %q, want 90210", tok)
	}
}

// Capability row 4 — a Google Doc straight to Markdown, no LLM in the path.
func TestExportDoc_Markdown(t *testing.T) {
	rec := newRecorder(t, step{
		name: "files.export", wantPath: "/files/1Doc_WeekOne_Notes/export",
		file: "export_doc.md", ctype: "text/markdown; charset=UTF-8",
		check: func(t *testing.T, r *http.Request) {
			wantAuthorized(t, r)
			wantQuery(t, r, "mimeType", "text/markdown")
		},
	})
	defer rec.done()

	body, ctype, err := testClient(rec).ExportDoc(context.Background(), "1Doc_WeekOne_Notes", "")
	if err != nil {
		t.Fatalf("ExportDoc: %v", err)
	}
	if !strings.HasPrefix(ctype, "text/markdown") {
		t.Errorf("Content-Type = %q, want text/markdown", ctype)
	}
	md := string(body)
	// Structure is the whole reason to prefer export over an LLM parse: if the
	// heading and the table survive, the phase 5 splitter can chunk it directly.
	for _, want := range []string{"# Week 1", "| Stage | Cost |", "| Retrieve | cheap |"} {
		if !strings.Contains(md, want) {
			t.Errorf("exported Markdown is missing %q", want)
		}
	}
}

func TestGetFile_UsedByThe410FullPass(t *testing.T) {
	rec := newRecorder(t, step{
		name: "files.get", wantPath: "/files/1Pdf_Attention",
		body: `{"id":"1Pdf_Attention","name":"attention.pdf","mimeType":"application/pdf","md5Checksum":"9a1f2c47b3de5e6f7a8b9c0d1e2f3a4b","modifiedTime":"2026-09-02T11:20:45.000Z","trashed":false}`,
		check: func(t *testing.T, r *http.Request) {
			if !strings.Contains(r.URL.Query().Get("fields"), "md5Checksum") {
				t.Error("files.get must request md5Checksum for post-410 change detection")
			}
		},
	})
	defer rec.done()

	f, err := testClient(rec).GetFile(context.Background(), "1Pdf_Attention")
	if err != nil {
		t.Fatalf("GetFile: %v", err)
	}
	if f.MD5Checksum == "" || f.Name != "attention.pdf" {
		t.Errorf("unexpected file %+v", f)
	}
}

// files.get?alt=media is the lane every non-Google file takes.
func TestDownloadFile_SendsAltMediaAndEnforcesTheCap(t *testing.T) {
	rec := newRecorder(t, step{
		name: "files.get media", wantPath: "/files/1Pdf_Attention",
		body: "%PDF-1.7 pretend bytes", ctype: "application/pdf",
		check: func(t *testing.T, r *http.Request) {
			wantAuthorized(t, r)
			wantQuery(t, r, "alt", "media")
		},
	})
	defer rec.done()

	data, err := testClient(rec).DownloadFile(context.Background(), "1Pdf_Attention", 1<<20)
	if err != nil {
		t.Fatalf("DownloadFile: %v", err)
	}
	if !strings.HasPrefix(string(data), "%PDF-") {
		t.Errorf("downloaded %q", string(data))
	}
}

// A file over the cap is an ERROR, not a truncation: half a PDF parses into
// confident nonsense and nothing downstream could tell.
func TestDownloadFile_OverTheCapIsRefusedNotTruncated(t *testing.T) {
	rec := newRecorder(t, step{
		name: "files.get oversized", wantPath: "/files/big",
		body: strings.Repeat("x", 128), ctype: "application/pdf",
	})
	defer rec.done()

	_, err := testClient(rec).DownloadFile(context.Background(), "big", 64)
	if err == nil {
		t.Fatal("an oversized file must be refused")
	}
	if !strings.Contains(err.Error(), "limit") {
		t.Errorf("error should name the limit, got %v", err)
	}
}

// A picked id arrives from the browser. It must not be able to widen the query
// it lands in.
func TestEscapeQueryLiteral_BlocksQueryInjection(t *testing.T) {
	got := escapeQueryLiteral(`x' in parents or '1' = '1`)
	if strings.Contains(got, `' in parents or '`) {
		t.Fatalf("injection survived escaping: %q", got)
	}
	if got != `x\' in parents or \'1\' = \'1` {
		t.Fatalf("escape = %q", got)
	}
}

func ids(files []File) []string {
	out := make([]string, len(files))
	for i, f := range files {
		out[i] = f.ID
	}
	return out
}

func index(files []File) map[string]File {
	m := make(map[string]File, len(files))
	for _, f := range files {
		m[f.ID] = f
	}
	return m
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
