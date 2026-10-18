package drive

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
)

// retry_test.go — drive-user-storage phase 5: import and sync answer a 401
// the way Storage does. One refresh and one retry; a second 401 marks the
// connection needs_reconnect. The 401 body is drivetest's, shaped from
// Google's documentation; no live run has been possible.

const (
	unauthorizedBody = "../drivetest/testdata/error_401_auth.json"
	freshToken       = "ya29.fresh-after-401"
)

func wantBearer(tok string) func(t *testing.T, r *http.Request) {
	return func(t *testing.T, r *http.Request) {
		t.Helper()
		if got := r.Header.Get("Authorization"); got != "Bearer "+tok {
			t.Errorf("Authorization = %q, want the bearer %q", got, tok)
		}
	}
}

func refreshStep() step {
	return step{name: "refresh after the 401", wantPath: "/token",
		body: `{"access_token":"` + freshToken + `","token_type":"Bearer","expires_in":3599,"scope":"` + ScopeDriveFile + `"}`}
}

func rejected(name, path, tok string) step {
	return step{name: name, wantPath: path, file: unauthorizedBody, status: http.StatusUnauthorized, check: wantBearer(tok)}
}

const pickedPDF = `{"id":"1Pdf_Attention","name":"attention.pdf","mimeType":"application/pdf","md5Checksum":"abc","modifiedTime":"2026-10-18T00:00:00Z"}`

// noTokenIn fails if any of the connection's tokens appears in s.
func noTokenIn(t *testing.T, what, s string) {
	t.Helper()
	for _, secret := range []string{"test-access-token", freshToken, "1//0g-stored-refresh"} {
		if strings.Contains(s, secret) {
			t.Fatalf("%s carries a token: %s", what, s)
		}
	}
}

func TestImportRetriesAfterOne401(t *testing.T) {
	rec := newRecorder(t,
		rejected("files.get, token revoked early", "/files/1Pdf_Attention", "test-access-token"),
		refreshStep(),
		step{name: "files.get again", wantPath: "/files/1Pdf_Attention", body: pickedPDF, check: wantBearer(freshToken)},
		step{name: "download", wantPath: "/files/1Pdf_Attention", body: "%PDF-1.7 attention", ctype: "application/pdf",
			check: func(t *testing.T, r *http.Request) {
				wantQuery(t, r, "alt", "media")
				wantBearer(freshToken)(t, r)
			}},
	)
	defer rec.done()

	svc, store, imp, user := newTestService(t, rec)
	report, err := svc.ImportPicked(context.Background(), user, uuid.New(), []Picked{{ID: "1Pdf_Attention", Kind: KindFile}})
	if err != nil {
		t.Fatal(err)
	}
	if report.Imported != 1 || report.Failed != 0 {
		t.Fatalf("one 401 was not refreshed and retried: %+v", report.Items)
	}
	if got := imp.importedIDs(); len(got) != 1 || got[0] != "1Pdf_Attention" {
		t.Fatalf("imported %v", got)
	}
	conn, _ := store.GetConnection(context.Background(), user)
	if conn.NeedsReconnect || conn.AccessToken != freshToken {
		t.Fatalf("after the retry: needs_reconnect=%v, stored token is the fresh one: %v",
			conn.NeedsReconnect, conn.AccessToken == freshToken)
	}
}

func TestImportTwo401sNeedReconnect(t *testing.T) {
	rec := newRecorder(t,
		rejected("files.get", "/files/1Pdf_Attention", "test-access-token"),
		refreshStep(),
		rejected("files.get with the fresh token", "/files/1Pdf_Attention", freshToken),
	)
	defer rec.done()

	svc, store, imp, user := newTestService(t, rec)
	var lost []uuid.UUID
	svc.OnLostAccess(func(u uuid.UUID) { lost = append(lost, u) })
	kb := uuid.New()
	report, err := svc.ImportPicked(context.Background(), user, kb, []Picked{{ID: "1Pdf_Attention", Kind: KindFile}})
	if err != nil {
		t.Fatal(err)
	}
	if report.Failed != 1 || report.Items[0].Error != "Drive needs to be reconnected." || report.Items[0].Code != "drive_reconnect" {
		t.Fatalf("a refused fresh token: %+v", report.Items)
	}
	if len(imp.importedIDs()) != 0 {
		t.Fatal("something was imported")
	}
	conn, _ := store.GetConnection(context.Background(), user)
	if !conn.NeedsReconnect {
		t.Fatal("two 401s did not mark the connection needs_reconnect")
	}
	if len(lost) != 1 || lost[0] != user {
		t.Fatalf("lost access reported for %v", lost)
	}
	answer, _ := json.Marshal(report)
	noTokenIn(t, "the import report", string(answer))

	// Marked: the next import and sync refuse without calling Google (the
	// recorder fails on any extra request).
	report, err = svc.ImportPicked(context.Background(), user, kb, []Picked{{ID: "1Pdf_Attention", Kind: KindFile}})
	if err != nil || report.Items[0].Error != "Drive needs to be reconnected." {
		t.Fatalf("an import after the mark: %v %+v", err, report)
	}
	if _, err := svc.Sync(context.Background(), user); !errors.Is(err, ErrNeedsReconnect) {
		t.Fatalf("a sync after the mark: %v", err)
	}
}

func TestSyncRetriesAfterOne401(t *testing.T) {
	rec := newRecorder(t,
		rejected("startPageToken", "/changes/startPageToken", "test-access-token"),
		refreshStep(),
		step{name: "startPageToken again", wantPath: "/changes/startPageToken", file: "start_page_token.json", check: wantBearer(freshToken)},
	)
	defer rec.done()

	svc, store, _, user := newTestService(t, rec)
	report, err := svc.Sync(context.Background(), user)
	if err != nil {
		t.Fatalf("one 401 was not refreshed and retried: %v", err)
	}
	if !report.Baselined {
		t.Fatal("the retried sync did not baseline")
	}
	if st, _ := store.GetSyncState(context.Background(), user); st == nil || st.StartPageToken == "" {
		t.Fatal("no checkpoint saved")
	}
	if conn, _ := store.GetConnection(context.Background(), user); conn.NeedsReconnect {
		t.Fatal("a refreshed token marked the connection")
	}
}

func TestSyncTwo401sNeedReconnect(t *testing.T) {
	rec := newRecorder(t,
		rejected("startPageToken", "/changes/startPageToken", "test-access-token"),
		refreshStep(),
		rejected("startPageToken with the fresh token", "/changes/startPageToken", freshToken),
	)
	defer rec.done()

	svc, store, _, user := newTestService(t, rec)
	_, err := svc.Sync(context.Background(), user)
	if !errors.Is(err, ErrNeedsReconnect) {
		t.Fatalf("a refused fresh token: %v", err)
	}
	for _, s := range []string{fmt.Sprintf("%v", err), fmt.Sprintf("%+v", err), fmt.Sprintf("%#v", err)} {
		noTokenIn(t, "the sync error", s)
	}
	if conn, _ := store.GetConnection(context.Background(), user); !conn.NeedsReconnect {
		t.Fatal("two 401s did not mark the connection needs_reconnect")
	}
	st, _ := store.GetSyncState(context.Background(), user)
	if st == nil || st.LastError != "Drive needs to be reconnected." {
		t.Fatalf("the sync state says %+v", st)
	}
	noTokenIn(t, "the sync state", st.LastError)
}

// Google's message is scrubbed of the token before it reaches an error, as
// Storage's is: the client and the storage share one rule (scrub).
func TestImportErrorsNeverCarryTheToken(t *testing.T) {
	rec := newRecorder(t,
		step{name: "files.get, 500 echoing the header", wantPath: "/files/1Pdf_Attention", status: http.StatusInternalServerError,
			body: `{"error":{"code":500,"message":"backend said: Bearer test-access-token"}}`},
	)
	defer rec.done()

	svc, _, _, user := newTestService(t, rec)
	_, err := svc.client(user).GetFile(context.Background(), "1Pdf_Attention")
	if err == nil || !strings.Contains(err.Error(), "[redacted]") {
		t.Fatalf("the echo was not scrubbed: %v", err)
	}
	for _, s := range []string{fmt.Sprintf("%v", err), fmt.Sprintf("%+v", err), fmt.Sprintf("%#v", err)} {
		noTokenIn(t, "the error", s)
	}
}

// A picked file whose copy the learner's own Drive refused to keep says why,
// with the reason's code, so the page offers what to do (phase 5).
func TestImportSaysWhyTheLearnersDriveRefusedTheCopy(t *testing.T) {
	for _, tc := range []struct {
		name  string
		err   error
		code  string
		error string
	}{
		{"full", fmt.Errorf("knowledge: keeping the original: %w", blob.ErrRemoteFull), "drive_full", blob.ReasonFull.Message},
		{"reconnect", fmt.Errorf("%w: %w", blob.ErrReconnect, ErrNeedsReconnect), "drive_reconnect", "Drive needs to be reconnected."},
		{"anything else", errors.New("knowledge: that file type is not supported"), "", "that file type is not supported"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := newRecorder(t,
				step{name: "files.get", wantPath: "/files/1Pdf_Attention", body: pickedPDF},
				step{name: "download", wantPath: "/files/1Pdf_Attention", body: "%PDF-1.7 attention", ctype: "application/pdf"},
			)
			defer rec.done()
			svc, _, imp, user := newTestService(t, rec)
			imp.err = tc.err
			report, err := svc.ImportPicked(context.Background(), user, uuid.New(), []Picked{{ID: "1Pdf_Attention", Kind: KindFile}})
			if err != nil {
				t.Fatal(err)
			}
			if got := report.Items[0]; got.Code != tc.code || got.Error != tc.error {
				t.Fatalf("answered %+v", got)
			}
		})
	}
}
