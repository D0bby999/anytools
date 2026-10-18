package drive

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/connectors/drive/drivetest"
)

// recover_test.go — drive-user-storage phase 3: a revoked or expired grant, a
// full Drive, a folder the learner trashed or deleted, and a reconnect.
// Against drivetest, whose answers (including the 401 authError body) are
// shaped from Google's documentation; no live run has been possible.

// tokenServer stands in for Google's token endpoint: it hands out
// drivetest.AccessToken, or refuses the grant as Google does for a revoked
// one.
type tokenServer struct {
	srv     *httptest.Server
	refused atomic.Bool
	calls   atomic.Int32
}

func newTokenServer(t *testing.T) *tokenServer {
	ts := &tokenServer{}
	ts.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ts.calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		if ts.refused.Load() {
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprint(w, `{"error":"invalid_grant","error_description":"Token has been expired or revoked."}`)
			return
		}
		fmt.Fprintf(w, `{"access_token":%q,"expires_in":3599,"token_type":"Bearer","scope":%q}`,
			drivetest.AccessToken, ScopeDriveFile)
	}))
	t.Cleanup(ts.srv.Close)
	return ts
}

// memFiles is the part of drive_files Storage reads.
type memFiles struct {
	mu      sync.Mutex
	files   int
	missing int
}

func (m *memFiles) CountDriveFiles(context.Context, uuid.UUID) (int, int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.files, int64(m.files) * 1000, nil
}

func (m *memFiles) ClearDriveFilesMissing(context.Context, uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.missing = 0
	return nil
}

// newRecoverFixture is newStorageFixture with a working token endpoint and
// a drive_files count.
func newRecoverFixture(t *testing.T) (*storageFixture, *tokenServer, *memFiles) {
	t.Helper()
	f := newStorageFixture(t)
	ts := newTokenServer(t)
	f.storage.svc.oauth.TokenURL = ts.srv.URL
	f.storage.svc.oauth.RevokeURL = ts.srv.URL + "/revoke"
	f.storage.svc.oauth.HTTP = ts.srv.Client()
	files := &memFiles{}
	f.storage.files = files
	f.storage.svc.UseStorage(f.storage)
	return f, ts, files
}

// noSecrets fails if an error, however it is printed, carries a token.
func noSecrets(t *testing.T, err error) {
	t.Helper()
	for _, s := range []string{fmt.Sprintf("%v", err), fmt.Sprintf("%+v", err), fmt.Sprintf("%#v", err)} {
		for _, secret := range []string{drivetest.AccessToken, storageRefresh, "SECRET"} {
			if strings.Contains(s, secret) {
				t.Fatalf("an error carries a token: %s", s)
			}
		}
	}
}

func TestA401IsRefreshedAndRetriedOnce(t *testing.T) {
	f, ts, _ := newRecoverFixture(t)
	ctx, data := context.Background(), payload()
	// The stored token still looks good for an hour, but Drive has stopped
	// taking it: the next request is answered 401.
	f.drive.Configure(func(o *drivetest.Options) { o.Unauthorized = 1 })
	got, err := f.storage.Put(ctx, f.user, uploadOf(data))
	if err != nil {
		t.Fatalf("one 401 was not refreshed and retried: %v", err)
	}
	if _, _, ok := f.drive.File(got.ID); !ok {
		t.Fatal("the upload did not land")
	}
	if n := ts.calls.Load(); n != 1 {
		t.Fatalf("%d refreshes, want 1", n)
	}
	if st := f.drive.Stats(); st.Unauthorized != 1 {
		t.Fatalf("%d 401s answered", st.Unauthorized)
	}
	conn, _ := f.store.GetConnection(ctx, f.user)
	if conn.NeedsReconnect {
		t.Fatal("a refreshed token marked the connection for reconnecting")
	}

	// A ranged read part way through playback is retried the same way.
	r, err := f.storage.Open(ctx, f.user, got.ID, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	f.drive.Configure(func(o *drivetest.Options) { o.Unauthorized = 1 })
	buf := make([]byte, 100)
	if _, err := r.Read(buf); err != nil {
		t.Fatalf("a range read after a 401: %v", err)
	}
	if string(buf) != string(data[:100]) {
		t.Fatal("the retried range read other bytes")
	}
}

func TestA401AfterAFreshTokenNeedsReconnect(t *testing.T) {
	f, ts, _ := newRecoverFixture(t)
	ctx := context.Background()
	f.drive.Configure(func(o *drivetest.Options) { o.Unauthorized = 2 })
	_, err := f.storage.Put(ctx, f.user, uploadOf(payload()))
	if !errors.Is(err, blob.ErrReconnect) || !errors.Is(err, ErrNeedsReconnect) {
		t.Fatalf("a refused fresh token: %v", err)
	}
	noSecrets(t, err)
	if reason, _ := blob.Unavailable(err); reason.Code != "drive_reconnect" || reason.Status != http.StatusConflict {
		t.Fatalf("answered as %+v", reason)
	}
	if n := ts.calls.Load(); n != 1 {
		t.Fatalf("%d refreshes, want exactly 1 before giving up", n)
	}
	conn, _ := f.store.GetConnection(ctx, f.user)
	if !conn.NeedsReconnect {
		t.Fatal("the connection was not marked for reconnecting")
	}
	// Marked: nothing more reaches Drive or the token endpoint.
	before := f.drive.Stats()
	if _, err := f.storage.Open(ctx, f.user, "file0001AbC_-", 10); !errors.Is(err, blob.ErrReconnect) {
		t.Fatalf("a read after the mark: %v", err)
	}
	if after := f.drive.Stats(); after.FolderChecks != before.FolderChecks || after.Unauthorized != before.Unauthorized || ts.calls.Load() != 1 {
		t.Fatal("a connection marked for reconnecting still called Google")
	}
}

func TestARevokedGrantRefusesReadsAndUploadsWithTheSameReason(t *testing.T) {
	f, ts, _ := newRecoverFixture(t)
	ctx, data := context.Background(), payload()
	got, err := f.storage.Put(ctx, f.user, uploadOf(data))
	if err != nil {
		t.Fatal(err)
	}
	// The learner revoked AnyTools in their Google account: the access
	// token is expired and the refresh is refused with invalid_grant.
	ts.refused.Store(true)
	past := time.Now().Add(-time.Hour)
	f.store.mu.Lock()
	f.store.conns[f.user].ExpiresAt = &past
	f.store.mu.Unlock()

	_, rerr := f.storage.Open(ctx, f.user, got.ID, int64(len(data)))
	_, uerr := f.storage.Put(ctx, f.user, uploadOf(data))
	for name, err := range map[string]error{"read": rerr, "upload": uerr} {
		if !errors.Is(err, blob.ErrReconnect) {
			t.Fatalf("%s with a revoked grant: %v", name, err)
		}
		if reason, ok := blob.Unavailable(err); !ok || reason != blob.ReasonReconnect {
			t.Fatalf("%s answered as %+v", name, reason)
		}
		noSecrets(t, err)
	}
	if conn, _ := f.store.GetConnection(ctx, f.user); !conn.NeedsReconnect {
		t.Fatal("invalid_grant did not mark the connection")
	}
}

func TestADisconnectedDriveIsReconnectNotMissing(t *testing.T) {
	f, _, _ := newRecoverFixture(t)
	ctx, data := context.Background(), payload()
	got, err := f.storage.Put(ctx, f.user, uploadOf(data))
	if err != nil {
		t.Fatal(err)
	}
	if err := f.store.DeleteConnection(ctx, f.user); err != nil {
		t.Fatal(err)
	}
	_, err = f.storage.Open(ctx, f.user, got.ID, int64(len(data)))
	if !errors.Is(err, blob.ErrReconnect) || errors.Is(err, blob.ErrRemoved) || errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("a read while disconnected: %v", err)
	}
}

func TestAFullDriveIsItsOwnReasonWhereverItIsMet(t *testing.T) {
	for _, tc := range []struct {
		name string
		set  func(*drivetest.Options)
	}{
		{"at the session", func(o *drivetest.Options) { o.Quota = true }},
		{"part way through", func(o *drivetest.Options) { o.QuotaOnChunk = true }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f, _, _ := newRecoverFixture(t)
			f.drive.Configure(tc.set)
			_, err := f.storage.Put(context.Background(), f.user, uploadOf(payload()))
			if !errors.Is(err, blob.ErrRemoteFull) || !QuotaExceeded(err) {
				t.Fatalf("a full Drive: %v", err)
			}
			if reason, _ := blob.Unavailable(err); reason != blob.ReasonFull {
				t.Fatalf("answered as %+v", reason)
			}
			noSecrets(t, err)
		})
	}
	// Another 403 is not "full".
	if errors.Is(&APIError{Status: 403, Reason: "insufficientFilePermissions"}, blob.ErrRemoteFull) {
		t.Fatal("every 403 reads as a full Drive")
	}
}

func TestATrashedFolderIsReplacedNeverWrittenInto(t *testing.T) {
	f, _, _ := newRecoverFixture(t)
	ctx := context.Background()
	if _, err := f.storage.Put(ctx, f.user, uploadOf(payload())); err != nil {
		t.Fatal(err)
	}
	first, _ := f.folders.ListFolders(ctx, f.user)

	// Only the Recordings folder is trashed: it is made again inside the
	// same "AnyTools" folder, and the others are found where they are.
	f.drive.Trash(first[blob.FolderRecordings], true)
	got, err := f.storage.Put(ctx, f.user, uploadOf(payload()))
	if err != nil {
		t.Fatal(err)
	}
	second, _ := f.folders.ListFolders(ctx, f.user)
	if second[blob.FolderRecordings] == first[blob.FolderRecordings] {
		t.Fatal("the trashed folder is still the one recorded")
	}
	for _, role := range blob.FolderRoles {
		if role != blob.FolderRecordings && second[role] != first[role] {
			t.Errorf("%s was replaced though it was not trashed", role)
		}
	}
	if _, meta, _ := f.drive.File(got.ID); meta.Parents[0] != second[blob.FolderRecordings] {
		t.Fatal("the upload went somewhere else")
	}
	if n := f.drive.FolderCount(); n != len(blob.FolderRoles)+1 {
		t.Fatalf("%d folders in Drive, want one more than before", n)
	}

	// The whole "AnyTools" folder is trashed: a new one is made, and the
	// trashed one is left in the trash for the learner.
	f.drive.Trash(second[blob.FolderRoot], true)
	if _, err := f.storage.Put(ctx, f.user, uploadOf(payload())); err != nil {
		t.Fatal(err)
	}
	third, _ := f.folders.ListFolders(ctx, f.user)
	for _, role := range blob.FolderRoles {
		if third[role] == second[role] {
			t.Errorf("%s is still inside the trashed AnyTools folder", role)
		}
	}
	if role, _, ok := f.drive.Folder(second[blob.FolderRoot]); !ok || role != blob.FolderRoot {
		t.Fatal("the trashed folder was deleted")
	}
}

func TestADeletedFolderIsMadeAgain(t *testing.T) {
	f, _, _ := newRecoverFixture(t)
	ctx := context.Background()
	if _, err := f.storage.Put(ctx, f.user, uploadOf(payload())); err != nil {
		t.Fatal(err)
	}
	first, _ := f.folders.ListFolders(ctx, f.user)
	f.drive.RemoveFolder(first[blob.FolderRecordings])
	if _, err := f.storage.Put(ctx, f.user, uploadOf(payload())); err != nil {
		t.Fatalf("an upload after the folder was deleted: %v", err)
	}
	second, _ := f.folders.ListFolders(ctx, f.user)
	if second[blob.FolderRecordings] == first[blob.FolderRecordings] || second[blob.FolderRoot] != first[blob.FolderRoot] {
		t.Fatalf("folders after a delete: %v, before %v", second, first)
	}
}

func TestReconnectFindsTheSameFoldersAndClearsTheMarks(t *testing.T) {
	f, _, files := newRecoverFixture(t)
	ctx := context.Background()
	if _, err := f.storage.Put(ctx, f.user, uploadOf(payload())); err != nil {
		t.Fatal(err)
	}
	first, _ := f.folders.ListFolders(ctx, f.user)
	creates := f.drive.Stats().Creates
	files.files, files.missing = 1, 1

	// Disconnected, the folder rows lost (as after a trashed-folder check
	// that could not finish); then connected again.
	if err := f.storage.svc.Disconnect(ctx, f.user); err != nil {
		t.Fatal(err)
	}
	_ = f.folders.ForgetFolders(ctx, f.user)
	if err := f.storage.svc.Connect(ctx, f.user, Credentials{
		RefreshToken: storageRefresh, AccessToken: drivetest.AccessToken, ExpiresIn: 3600, Scope: ScopeDriveFile,
	}); err != nil {
		t.Fatal(err)
	}
	again, _ := f.folders.ListFolders(ctx, f.user)
	if len(again) != len(blob.FolderRoles) {
		t.Fatalf("%d folders found again", len(again))
	}
	for role, id := range first {
		if again[role] != id {
			t.Errorf("%s: %s after the reconnect, %s before", role, again[role], id)
		}
	}
	if n := f.drive.Stats().Creates; n != creates {
		t.Fatalf("a reconnect created %d folders", n-creates)
	}
	if files.missing != 0 {
		t.Fatal("a reconnect kept the removed-from-Drive marks")
	}
	if n := f.drive.FileCount(); n != 1 {
		t.Fatalf("a reconnect copied files: %d in Drive", n)
	}
}

func TestReconnectReplacesFoldersThisAccountCannotSee(t *testing.T) {
	f, _, files := newRecoverFixture(t)
	ctx := context.Background()
	if _, err := f.storage.EnsureFolders(ctx, f.user); err != nil {
		t.Fatal(err)
	}
	files.files = 1
	// The recorded folders are not there for this account.
	_ = f.folders.ForgetFolders(ctx, f.user)
	for _, role := range blob.FolderRoles {
		_ = f.folders.SaveFolder(ctx, f.user, role, "folderGone"+role)
	}
	f.storage.Reconnected(ctx, f.user)
	again, _ := f.folders.ListFolders(ctx, f.user)
	for role, id := range again {
		if strings.HasPrefix(id, "folderGone") {
			t.Errorf("%s still names a folder Drive does not have", role)
		}
	}
}

func TestReconnectWithNothingInDriveAsksDriveNothing(t *testing.T) {
	f, _, _ := newRecoverFixture(t)
	f.storage.Reconnected(context.Background(), f.user)
	if st := f.drive.Stats(); st.Lists+st.Creates+st.FolderChecks != 0 {
		t.Fatalf("a first connect reached Drive: %+v", st)
	}
}

func TestStatusCountsTheFilesInDriveWhileDisconnected(t *testing.T) {
	f, _, files := newRecoverFixture(t)
	ctx := context.Background()
	files.files = 3
	if err := f.storage.svc.Disconnect(ctx, f.user); err != nil {
		t.Fatal(err)
	}
	st, err := f.storage.svc.Status(ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	if st.Connected || st.FilesInDrive != 3 || st.BytesInDrive != 3000 {
		t.Fatalf("status %+v", st)
	}
}

// Losing access to a learner's Drive, by any of the three ways, tells the
// server to drop its copies; a 401 that a refresh cures does not.
func TestLostAccessIsReportedOnlyWhenAccessIsLost(t *testing.T) {
	for _, tc := range []struct {
		name string
		lose func(f *storageFixture, ts *tokenServer) error
		want bool
	}{
		{"a 401 cured by a refresh", func(f *storageFixture, _ *tokenServer) error {
			f.drive.Configure(func(o *drivetest.Options) { o.Unauthorized = 1 })
			_, err := f.storage.EnsureFolders(context.Background(), f.user)
			return err
		}, false},
		{"a fresh token refused", func(f *storageFixture, _ *tokenServer) error {
			f.drive.Configure(func(o *drivetest.Options) { o.Unauthorized = 2 })
			_, err := f.storage.EnsureFolders(context.Background(), f.user)
			return ignore(err, blob.ErrReconnect)
		}, true},
		{"a revoked grant", func(f *storageFixture, ts *tokenServer) error {
			ts.refused.Store(true)
			past := time.Now().Add(-time.Hour)
			f.store.mu.Lock()
			f.store.conns[f.user].ExpiresAt = &past
			f.store.mu.Unlock()
			_, err := f.storage.EnsureFolders(context.Background(), f.user)
			return ignore(err, blob.ErrReconnect)
		}, true},
		{"a disconnect", func(f *storageFixture, _ *tokenServer) error {
			return f.storage.svc.Disconnect(context.Background(), f.user)
		}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f, ts, _ := newRecoverFixture(t)
			var lost []uuid.UUID
			f.storage.svc.OnLostAccess(func(u uuid.UUID) { lost = append(lost, u) })
			if err := tc.lose(f, ts); err != nil {
				t.Fatal(err)
			}
			if got := len(lost) > 0; got != tc.want || (got && lost[0] != f.user) {
				t.Fatalf("lost access reported for %v", lost)
			}
		})
	}
}

func ignore(err, want error) error {
	if errors.Is(err, want) {
		return nil
	}
	if err == nil {
		return errors.New("no error, want one")
	}
	return err
}
