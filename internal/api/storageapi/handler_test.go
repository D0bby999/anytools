package storageapi_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/api/storageapi"
	"github.com/D0bby999/anytools/internal/api/storageapi/storagetest"
	"github.com/D0bby999/anytools/internal/blob"
)

// handler_test.go — Settings → Storage's routes over the in-memory fake.
// The Postgres, router and Drive half is proven end to end in
// internal/app/storage_move_test.go.

type answer struct {
	code int
	body map[string]any
}

func call(t *testing.T, h *storageapi.Handler, user uuid.UUID, method, path string, body any) answer {
	t.Helper()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(raw))
	req = req.WithContext(httpx.WithUserID(req.Context(), user))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	out := answer{code: rec.Code}
	_ = json.Unmarshal(rec.Body.Bytes(), &out.body)
	return out
}

func errCode(a answer) string {
	if e, ok := a.body["error"].(map[string]any); ok {
		c, _ := e["code"].(string)
		return c
	}
	c, _ := a.body["code"].(string)
	return c
}

func TestChoosingDriveNeedsAConnection(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		code string
	}{
		{"not connected", storageapi.ErrDriveNotConnected, "drive_not_connected"},
		{"revoked", storageapi.ErrDriveReconnect, "drive_reconnect"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := storagetest.New()
			f.Default = blob.StorageServer
			f.NotReady = tc.err
			user := uuid.New()
			a := call(t, f.Handler(), user, http.MethodPut, "/v1/me/file-storage", map[string]string{"storage": "drive"})
			if a.code != http.StatusConflict || errCode(a) != tc.code {
				t.Fatalf("PUT drive = %d %v, want 409 %s", a.code, a.body, tc.code)
			}
			if s, _ := f.FileStorage(t.Context(), user); s != blob.StorageServer || len(f.Folders) != 0 {
				t.Fatalf("the choice changed to %q, folders %v", s, f.Folders)
			}
		})
	}
}

func TestChoosingDriveWithoutDriveOnThisServer(t *testing.T) {
	f := storagetest.New()
	f.Default = blob.StorageServer
	h := storageapi.NewHandler(f, nil, f)
	a := call(t, h, uuid.New(), http.MethodPut, "/v1/me/file-storage", map[string]string{"storage": "drive"})
	if a.code != http.StatusConflict || errCode(a) != "drive_unavailable" {
		t.Fatalf("PUT drive = %d %v", a.code, a.body)
	}
	if h.Exports() != nil {
		t.Fatal("Save to my Drive is offered with no Drive")
	}
	// The status still answers: the server is the only choice.
	st := call(t, h, uuid.New(), http.MethodGet, "/v1/me/file-storage", nil)
	if st.code != http.StatusOK || st.body["storage"] != "server" || st.body["drive"].(map[string]any)["configured"] != false {
		t.Fatalf("GET = %d %v", st.code, st.body)
	}
}

func TestChoosingDriveMakesTheFoldersFirst(t *testing.T) {
	f := storagetest.New()
	f.Default = blob.StorageServer
	user := uuid.New()
	a := call(t, f.Handler(), user, http.MethodPut, "/v1/me/file-storage", map[string]string{"storage": "drive"})
	if a.code != http.StatusOK || a.body["storage"] != "drive" {
		t.Fatalf("PUT drive = %d %v", a.code, a.body)
	}
	if len(f.Folders) != 1 || f.Folders[0] != user {
		t.Fatalf("folders made for %v", f.Folders)
	}

	// A Drive that cannot be reached leaves the choice where it was.
	f2 := storagetest.New()
	f2.Default = blob.StorageServer
	f2.FolderErr = storageapi.ErrDriveFull
	a = call(t, f2.Handler(), user, http.MethodPut, "/v1/me/file-storage", map[string]string{"storage": "drive"})
	if a.code != http.StatusConflict || errCode(a) != "drive_full" {
		t.Fatalf("PUT drive on a full Drive = %d %v", a.code, a.body)
	}
	if s, _ := f2.FileStorage(t.Context(), user); s != blob.StorageServer {
		t.Fatalf("choice = %q", s)
	}
}

func TestChoosingSomethingElseIsRefused(t *testing.T) {
	f := storagetest.New()
	a := call(t, f.Handler(), uuid.New(), http.MethodPut, "/v1/me/file-storage", map[string]string{"storage": "dropbox"})
	if a.code != http.StatusBadRequest {
		t.Fatalf("PUT dropbox = %d", a.code)
	}
}

func TestMoveStartsOnceAndReportsProgress(t *testing.T) {
	f := storagetest.New()
	user := uuid.New()
	h := f.Handler()

	a := call(t, h, user, http.MethodPost, "/v1/me/file-storage/move", nil)
	if a.code != http.StatusOK || a.body["nothing_to_move"] != true {
		t.Fatalf("move with nothing to move = %d %v", a.code, a.body)
	}

	f.Plan = []blob.MoveItem{{Kind: "original", Key: "a", Bytes: 1000}, {Kind: "recordings", Key: "b", Bytes: 3000}, {Kind: "audio", Key: "c", Bytes: 6000}}
	a = call(t, h, user, http.MethodPost, "/v1/me/file-storage/move", nil)
	if a.code != http.StatusAccepted {
		t.Fatalf("move = %d %v", a.code, a.body)
	}
	var p storageapi.MovePayload
	if err := json.Unmarshal(f.Jobs[0].Payload, &p); err != nil || p.Direction != blob.MoveToDrive || len(p.Items) != 3 {
		t.Fatalf("planned %+v, %v", p, err)
	}

	again := call(t, h, user, http.MethodPost, "/v1/me/file-storage/move", nil)
	if again.code != http.StatusConflict || errCode(again) != "move_running" {
		t.Fatalf("second move = %d %v", again.code, again.body)
	}
	change := call(t, h, user, http.MethodPut, "/v1/me/file-storage", map[string]string{"storage": "server"})
	if change.code != http.StatusConflict || errCode(change) != "move_running" {
		t.Fatalf("changing the choice mid-move = %d %v", change.code, change.body)
	}

	f.SetJob(user, "running", `{"done":2,"total":3}`, "")
	st := call(t, h, user, http.MethodGet, "/v1/me/file-storage", nil)
	m := st.body["move"].(map[string]any)
	if m["done"] != 2.0 || m["total"] != 3.0 || m["done_bytes"] != 4000.0 || m["total_bytes"] != 10000.0 || m["direction"] != "to_drive" {
		t.Fatalf("progress = %v", m)
	}
	// Another learner sees no move of theirs.
	if other := call(t, h, uuid.New(), http.MethodGet, "/v1/me/file-storage", nil); other.body["move"] != nil {
		t.Fatalf("another learner sees %v", other.body["move"])
	}

	if c := call(t, h, user, http.MethodPost, "/v1/me/file-storage/move/cancel", nil); c.code != http.StatusNoContent {
		t.Fatalf("cancel = %d", c.code)
	}
	if !f.Jobs[0].CancelRequested {
		t.Fatal("the cancel was not requested")
	}
	if c := call(t, h, uuid.New(), http.MethodPost, "/v1/me/file-storage/move/cancel", nil); c.code != http.StatusNotFound {
		t.Fatalf("cancel with no move = %d", c.code)
	}
}

// A stopped move says why with a code, never the job's own error text.
func TestAStoppedMoveSaysWhyByCode(t *testing.T) {
	for _, tc := range []struct{ lastError, status, code string }{
		{"drive_full: drive: 403 storageQuotaExceeded", "failed", "drive_full"},
		{"drive_reconnect: drive: the Google Drive connection needs to be reconnected", "failed", "drive_reconnect"},
		{"cancelled", "cancelled", ""},
		{"drive: GET www.googleapis.com: connection reset", "failed", "move_failed"},
	} {
		f := storagetest.New()
		user := uuid.New()
		f.Plan = []blob.MoveItem{{Kind: "original", Key: "a", Bytes: 1}}
		call(t, f.Handler(), user, http.MethodPost, "/v1/me/file-storage/move", nil)
		f.SetJob(user, "failed", `{"done":0}`, tc.lastError)
		m := call(t, f.Handler(), user, http.MethodGet, "/v1/me/file-storage", nil).body["move"].(map[string]any)
		if m["status"] != tc.status || (m["error"] != nil && m["error"] != tc.code) || (tc.code != "" && m["error"] != tc.code) {
			t.Fatalf("%q → %v", tc.lastError, m)
		}
	}
}

func TestMovingBackNeedsDriveToo(t *testing.T) {
	f := storagetest.New()
	f.Default = blob.StorageServer
	f.NotReady = storageapi.ErrDriveReconnect
	f.Plan = []blob.MoveItem{{Kind: "original", Key: "a", Bytes: 1}}
	a := call(t, f.Handler(), uuid.New(), http.MethodPost, "/v1/me/file-storage/move", nil)
	if a.code != http.StatusConflict || errCode(a) != "drive_reconnect" || len(f.Jobs) != 0 {
		t.Fatalf("move back with a revoked Drive = %d %v, %d jobs", a.code, a.body, len(f.Jobs))
	}
}

func TestSaveToMyDriveNeedsDriveStorageOn(t *testing.T) {
	f := storagetest.New()
	f.Default = blob.StorageServer
	mux := http.NewServeMux()
	exports := f.Exports()
	mux.HandleFunc("POST /x", func(w http.ResponseWriter, r *http.Request) {
		exports.Save(w, r, "worksheet:1", "week-3.md", "# Week 3")
	})
	do := func() int {
		req := httptest.NewRequest(http.MethodPost, "/x", nil)
		req = req.WithContext(httpx.WithUserID(req.Context(), uuid.New()))
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec.Code
	}
	if got := do(); got != http.StatusConflict || len(f.Saved) != 0 {
		t.Fatalf("save with server storage = %d, %d saved", got, len(f.Saved))
	}
	f.Default = blob.StorageDrive
	if got := do(); got != http.StatusCreated || len(f.Saved) != 1 {
		t.Fatalf("save = %d, %d saved", got, len(f.Saved))
	}
	if s := f.Saved[0]; s.MIME != "text/markdown" || s.Data != "# Week 3" || s.Key != "worksheet:1" {
		t.Fatalf("saved %+v", s)
	}
}

func TestExportNamesCarryTheLearnersLocalTime(t *testing.T) {
	at := time.Date(2026, 10, 17, 14, 5, 0, 0, time.UTC)
	for in, want := range map[string]string{
		"week-3.md":     "week-3 2026-10-17 21.05.md",
		"notes":         "notes 2026-10-17 21.05.md",
		`a/b"c.md`:      "a-bc 2026-10-17 21.05.md",
		".md":           "Export 2026-10-17 21.05.md",
		"book title.md": "book title 2026-10-17 21.05.md",
	} {
		if got := storageapi.StampedName(in, at, "Asia/Ho_Chi_Minh"); got != want {
			t.Errorf("StampedName(%q) = %q, want %q", in, got, want)
		}
	}
}
