package notebookapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/api"
	"github.com/D0bby999/anytools/internal/api/notebookapi"
	"github.com/D0bby999/anytools/internal/api/storageapi/storagetest"
	"github.com/D0bby999/anytools/internal/notebook"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

const testGatewayToken = "notebookapi-test-token"

type harness struct {
	pool       *pgxpool.Pool
	server     *httptest.Server
	alice, bob uuid.UUID
	// drive is "Save to my Drive", in memory.
	drive *storagetest.Fake
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	pool := testutil.TestDB(t)
	h := &harness{
		pool:  pool,
		alice: testutil.NewUser(t, pool),
		bob:   testutil.NewUser(t, pool),
		drive: storagetest.New(),
	}
	svc := notebook.NewService(pg.NewNotebookStore(pool))
	h.server = httptest.NewServer(api.BuildMux(api.Deps{
		Notebook:     notebookapi.NewHandler(svc).WithDriveExport(h.drive.Exports()),
		Users:        stubUsers{live: map[uuid.UUID]bool{h.alice: true, h.bob: true}},
		GatewayToken: testGatewayToken,
	}))
	t.Cleanup(h.server.Close)
	return h
}

func (h *harness) do(t *testing.T, userID uuid.UUID, method, path string, body any) *http.Response {
	t.Helper()
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, h.server.URL+path, reader)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+testGatewayToken)
	req.Header.Set("X-AnyTools-User-Id", userID.String())
	req.Header.Set("Content-Type", "application/json")
	res, err := h.server.Client().Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return res
}

func decode[T any](t *testing.T, res *http.Response, wantStatus int) T {
	t.Helper()
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != wantStatus {
		t.Fatalf("status %d, want %d (body %s)", res.StatusCode, wantStatus, body)
	}
	var out T
	if len(body) > 0 {
		if err := json.Unmarshal(body, &out); err != nil {
			t.Fatalf("decode %s: %v", body, err)
		}
	}
	return out
}

func status(t *testing.T, res *http.Response) int {
	t.Helper()
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, res.Body)
	return res.StatusCode
}

func (h *harness) newNotebook(t *testing.T, userID uuid.UUID, name string) notebook.Notebook {
	t.Helper()
	return decode[notebook.Notebook](t,
		h.do(t, userID, http.MethodPost, "/v1/notebooks", map[string]any{"name": name}),
		http.StatusCreated)
}

func (h *harness) newNote(t *testing.T, userID, notebookID uuid.UUID, title string) notebook.Note {
	t.Helper()
	return decode[notebook.Note](t,
		h.do(t, userID, http.MethodPost, "/v1/notebooks/"+notebookID.String()+"/notes",
			map[string]any{"title": title, "body_md": "body of " + title}),
		http.StatusCreated)
}

// ────────────────────────────────────────────────────────────────── tests

func TestNotebookCRUDOverHTTP(t *testing.T) {
	h := newHarness(t)

	nb := h.newNotebook(t, h.alice, "Chemistry")
	if !nb.IsDefault {
		t.Fatal("the first notebook a user creates must become their default")
	}

	second := h.newNotebook(t, h.alice, "Physics")
	if second.IsDefault {
		t.Fatal("the second notebook took the default away from the first")
	}

	note := h.newNote(t, h.alice, nb.ID, "Le Chatelier")
	if note.CreatedBy != notebook.CreatedByUser {
		t.Fatalf("created_by = %q, want user", note.CreatedBy)
	}

	renamed := decode[notebook.Notebook](t,
		h.do(t, h.alice, http.MethodPatch, "/v1/notebooks/"+nb.ID.String(),
			map[string]any{"name": "Chemistry 2026"}),
		http.StatusOK)
	if renamed.Name != "Chemistry 2026" {
		t.Fatalf("name = %q", renamed.Name)
	}

	if got := status(t, h.do(t, h.alice, http.MethodDelete, "/v1/notes/"+note.ID.String(), nil)); got != http.StatusNoContent {
		t.Fatalf("delete note: status %d", got)
	}
	if got := status(t, h.do(t, h.alice, http.MethodGet, "/v1/notes/"+note.ID.String(), nil)); got != http.StatusNotFound {
		t.Fatalf("deleted note still readable: status %d", got)
	}
}

// TestAnEmptyNameIsRefusedWithASentence: the only error whose text reaches a
// person is the one written for them.
func TestAnEmptyNameIsRefusedWithASentence(t *testing.T) {
	h := newHarness(t)
	res := h.do(t, h.alice, http.MethodPost, "/v1/notebooks", map[string]any{"name": "   "})
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", res.StatusCode)
	}
	body, _ := io.ReadAll(res.Body)
	if !strings.Contains(string(body), "name") {
		t.Fatalf("the refusal does not say what was wrong: %s", body)
	}
	if strings.Contains(string(body), "notebook: invalid") {
		t.Fatalf("an internal sentinel's prefix leaked to the client: %s", body)
	}
}

// TestARequestBodyCannotClaimTheAgentsAuthorship. Phase 10 reads created_by as
// evidence provenance, so a note written through this endpoint is always the
// reader's own.
//
// The guarantee turns out to be stronger than "the field is ignored": the
// request shape has no `created_by` at all, and httpx.DecodeJSON rejects
// unknown fields, so a body that mentions it is refused outright. Both halves
// are asserted — the refusal, and the authorship of a note written without it —
// because a later widening of the request struct would silently turn the 400
// into an accepted claim, and only the second assertion would catch that.
func TestARequestBodyCannotClaimTheAgentsAuthorship(t *testing.T) {
	h := newHarness(t)
	nb := h.newNotebook(t, h.alice, "Notes")

	if got := status(t, h.do(t, h.alice, http.MethodPost, "/v1/notebooks/"+nb.ID.String()+"/notes",
		map[string]any{"title": "Mine", "body_md": "x", "created_by": "agent"})); got != http.StatusBadRequest {
		t.Fatalf("a body naming created_by: status %d, want 400", got)
	}

	note := h.newNote(t, h.alice, nb.ID, "Mine")
	if note.CreatedBy != notebook.CreatedByUser {
		t.Fatalf("created_by = %q, want user", note.CreatedBy)
	}
}

func TestMoveAndCopyBetweenNotebooks(t *testing.T) {
	h := newHarness(t)
	from := h.newNotebook(t, h.alice, "Inbox")
	to := h.newNotebook(t, h.alice, "Revision")
	note := h.newNote(t, h.alice, from.ID, "RRF")

	moved := decode[notebook.Note](t,
		h.do(t, h.alice, http.MethodPost, "/v1/notes/"+note.ID.String()+"/move",
			map[string]any{"notebook_id": to.ID.String()}),
		http.StatusOK)
	if moved.NotebookID != to.ID {
		t.Fatalf("moved to %s, want %s", moved.NotebookID, to.ID)
	}

	copied := decode[notebook.Note](t,
		h.do(t, h.alice, http.MethodPost, "/v1/notes/"+note.ID.String()+"/copy",
			map[string]any{"notebook_id": from.ID.String()}),
		http.StatusCreated)
	if copied.ID == note.ID {
		t.Fatal("copy returned the original note")
	}
	if copied.NotebookID != from.ID {
		t.Fatalf("copy landed in %s, want %s", copied.NotebookID, from.ID)
	}

	// The original is still where the move put it: a copy is not a second move.
	still := decode[notebook.Note](t,
		h.do(t, h.alice, http.MethodGet, "/v1/notes/"+note.ID.String(), nil), http.StatusOK)
	if still.NotebookID != to.ID {
		t.Fatalf("the original moved again: %s", still.NotebookID)
	}
}

func TestCategoriesFileAndUnfileNotes(t *testing.T) {
	h := newHarness(t)
	nb := h.newNotebook(t, h.alice, "Chemistry")

	cat := decode[notebook.Category](t,
		h.do(t, h.alice, http.MethodPost, "/v1/notebooks/"+nb.ID.String()+"/categories",
			map[string]any{"name": "Formulas"}),
		http.StatusCreated)

	note := h.newNote(t, h.alice, nb.ID, "Le Chatelier")
	filed := decode[notebook.Note](t,
		h.do(t, h.alice, http.MethodPatch, "/v1/notes/"+note.ID.String(),
			map[string]any{"category_ids": []string{cat.ID.String()}}),
		http.StatusOK)
	if len(filed.CategoryIDs) != 1 || filed.CategoryIDs[0] != cat.ID {
		t.Fatalf("category_ids = %v", filed.CategoryIDs)
	}

	listed := decode[struct {
		Notes []notebook.Note `json:"notes"`
	}](t, h.do(t, h.alice, http.MethodGet,
		"/v1/notebooks/"+nb.ID.String()+"/notes?category_id="+cat.ID.String(), nil), http.StatusOK)
	if len(listed.Notes) != 1 {
		t.Fatalf("%d notes in the category, want 1", len(listed.Notes))
	}

	// PATCH replaces the set, so an empty list unfiles.
	unfiled := decode[notebook.Note](t,
		h.do(t, h.alice, http.MethodPatch, "/v1/notes/"+note.ID.String(),
			map[string]any{"category_ids": []string{}}),
		http.StatusOK)
	if len(unfiled.CategoryIDs) != 0 {
		t.Fatalf("category_ids = %v, want none", unfiled.CategoryIDs)
	}

	// Deleting a category keeps its notes.
	if got := status(t, h.do(t, h.alice, http.MethodDelete,
		"/v1/note-categories/"+cat.ID.String(), nil)); got != http.StatusNoContent {
		t.Fatalf("delete category: status %d", got)
	}
	if got := status(t, h.do(t, h.alice, http.MethodGet,
		"/v1/notes/"+note.ID.String(), nil)); got != http.StatusOK {
		t.Fatalf("the note died with its category: status %d", got)
	}
}

func TestExportServesMarkdownAsAnAttachment(t *testing.T) {
	h := newHarness(t)
	// A name that would break out of a Content-Disposition header if it were
	// interpolated rather than slugged.
	nb := h.newNotebook(t, h.alice, `Chem"; filename="evil.html`)
	h.newNote(t, h.alice, nb.ID, "Le Chatelier")

	res := h.do(t, h.alice, http.MethodGet, "/v1/notebooks/"+nb.ID.String()+"/export.md", nil)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/markdown") {
		t.Fatalf("content-type = %q", ct)
	}
	if res.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("the export lets a browser sniff a user's Markdown into HTML")
	}
	cd := res.Header.Get("Content-Disposition")
	if !strings.HasPrefix(cd, "attachment;") {
		t.Fatalf("content-disposition = %q", cd)
	}
	if strings.Contains(cd, "evil.html") {
		t.Fatalf("the notebook's name reached the header verbatim: %q", cd)
	}

	md, _ := io.ReadAll(res.Body)
	if !strings.Contains(string(md), "## Le Chatelier") {
		t.Fatalf("export.md:\n%s", md)
	}
}

// TestCrossUserIsolationOnEveryIdRoute probes every route that takes an id with
// the WRONG user and requires 404 — never 403, never 200.
func TestCrossUserIsolationOnEveryIdRoute(t *testing.T) {
	h := newHarness(t)

	nb := h.newNotebook(t, h.alice, "Alice's")
	cat := decode[notebook.Category](t,
		h.do(t, h.alice, http.MethodPost, "/v1/notebooks/"+nb.ID.String()+"/categories",
			map[string]any{"name": "Private"}),
		http.StatusCreated)
	note := h.newNote(t, h.alice, nb.ID, "Private")
	bobBook := h.newNotebook(t, h.bob, "Bob's")

	nbID, noteID := nb.ID.String(), note.ID.String()
	probes := []struct {
		name, method, path string
		body               any
	}{
		{"GET /v1/notebooks/{id}", http.MethodGet, "/v1/notebooks/" + nbID, nil},
		{"PATCH /v1/notebooks/{id}", http.MethodPatch, "/v1/notebooks/" + nbID, map[string]any{"name": "stolen"}},
		{"DELETE /v1/notebooks/{id}", http.MethodDelete, "/v1/notebooks/" + nbID, nil},
		{"GET /v1/notebooks/{id}/export.md", http.MethodGet, "/v1/notebooks/" + nbID + "/export.md", nil},
		{"POST /v1/notebooks/{id}/export/drive", http.MethodPost, "/v1/notebooks/" + nbID + "/export/drive", nil},
		{"GET /v1/notebooks/{id}/notes", http.MethodGet, "/v1/notebooks/" + nbID + "/notes", nil},
		{"POST /v1/notebooks/{id}/notes", http.MethodPost, "/v1/notebooks/" + nbID + "/notes",
			map[string]any{"title": "stolen", "body_md": "x"}},
		{"GET /v1/notebooks/{id}/categories", http.MethodGet, "/v1/notebooks/" + nbID + "/categories", nil},
		{"POST /v1/notebooks/{id}/categories", http.MethodPost, "/v1/notebooks/" + nbID + "/categories",
			map[string]any{"name": "stolen"}},
		{"DELETE /v1/note-categories/{id}", http.MethodDelete, "/v1/note-categories/" + cat.ID.String(), nil},
		{"GET /v1/notes/{id}", http.MethodGet, "/v1/notes/" + noteID, nil},
		{"PATCH /v1/notes/{id}", http.MethodPatch, "/v1/notes/" + noteID, map[string]any{"title": "stolen"}},
		{"DELETE /v1/notes/{id}", http.MethodDelete, "/v1/notes/" + noteID, nil},
		{"POST /v1/notes/{id}/move", http.MethodPost, "/v1/notes/" + noteID + "/move",
			map[string]any{"notebook_id": bobBook.ID.String()}},
		{"POST /v1/notes/{id}/copy", http.MethodPost, "/v1/notes/" + noteID + "/copy",
			map[string]any{"notebook_id": bobBook.ID.String()}},
	}
	for _, p := range probes {
		if got := status(t, h.do(t, h.bob, p.method, p.path, p.body)); got != http.StatusNotFound {
			t.Errorf("%s as the wrong user: status %d, want 404", p.name, got)
		}
	}
	if len(h.drive.Saved) != 0 {
		t.Fatalf("alice's notebook was saved to a Drive: %+v", h.drive.Saved)
	}

	// Collection routes: no error, no rows.
	books := decode[struct {
		Notebooks []notebook.Notebook `json:"notebooks"`
	}](t, h.do(t, h.bob, http.MethodGet, "/v1/notebooks", nil), http.StatusOK)
	for _, b := range books.Notebooks {
		if b.ID == nb.ID {
			t.Fatal("alice's notebook appeared in bob's list")
		}
	}
	notes := decode[struct {
		Notes []notebook.Note `json:"notes"`
	}](t, h.do(t, h.bob, http.MethodGet, "/v1/notes", nil), http.StatusOK)
	for _, n := range notes.Notes {
		if n.ID == note.ID {
			t.Fatal("alice's note appeared in bob's cross-notebook listing")
		}
	}

	// Alice's rows survived every probe.
	if got := status(t, h.do(t, h.alice, http.MethodGet, "/v1/notes/"+noteID, nil)); got != http.StatusOK {
		t.Fatalf("alice lost her note to bob's probes: status %d", got)
	}
}

// TestEveryIdRouteIsProbed keeps the sweep above honest.
func TestEveryIdRouteIsProbed(t *testing.T) {
	probed := map[string]bool{
		"GET /v1/notebooks/{id}":               true,
		"PATCH /v1/notebooks/{id}":             true,
		"DELETE /v1/notebooks/{id}":            true,
		"GET /v1/notebooks/{id}/export.md":     true,
		"POST /v1/notebooks/{id}/export/drive": true,
		"GET /v1/notebooks/{id}/notes":         true,
		"POST /v1/notebooks/{id}/notes":        true,
		"GET /v1/notebooks/{id}/categories":    true,
		"POST /v1/notebooks/{id}/categories":   true,
		"DELETE /v1/note-categories/{id}":      true,
		"GET /v1/notes/{id}":                   true,
		"PATCH /v1/notes/{id}":                 true,
		"DELETE /v1/notes/{id}":                true,
		"POST /v1/notes/{id}/move":             true,
		"POST /v1/notes/{id}/copy":             true,
		// No id: scoped by the authenticated user alone.
		"GET /v1/notebooks":  true,
		"POST /v1/notebooks": true,
		"GET /v1/notes":      true,
	}
	for _, p := range notebookapi.Patterns() {
		if !probed[p] {
			t.Errorf("%s has no cross-user probe in TestCrossUserIsolationOnEveryIdRoute", p)
		}
	}
}

// TestAMoveToAForeignNotebookIsRefused is the half a filter on the SOURCE row
// alone would miss: alice owns the note, bob owns the destination.
func TestAMoveToAForeignNotebookIsRefused(t *testing.T) {
	h := newHarness(t)
	alicesBook := h.newNotebook(t, h.alice, "Alice's")
	bobsBook := h.newNotebook(t, h.bob, "Bob's")
	note := h.newNote(t, h.alice, alicesBook.ID, "Mine")

	if got := status(t, h.do(t, h.alice, http.MethodPost, "/v1/notes/"+note.ID.String()+"/move",
		map[string]any{"notebook_id": bobsBook.ID.String()})); got != http.StatusNotFound {
		t.Fatalf("move into bob's notebook: status %d, want 404", got)
	}
	still := decode[notebook.Note](t,
		h.do(t, h.alice, http.MethodGet, "/v1/notes/"+note.ID.String(), nil), http.StatusOK)
	if still.NotebookID != alicesBook.ID {
		t.Fatalf("the note moved anyway: %s", still.NotebookID)
	}
}

func TestAMalformedIdIsIndistinguishableFromAForeignOne(t *testing.T) {
	h := newHarness(t)
	for _, id := range []string{"not-a-uuid", uuid.Nil.String(), uuid.NewString()} {
		if got := status(t, h.do(t, h.alice, http.MethodGet, "/v1/notebooks/"+id, nil)); got != http.StatusNotFound {
			t.Errorf("GET /v1/notebooks/%s: status %d, want 404", id, got)
		}
	}
}

// ---- fakes ------------------------------------------------------------------

type stubUsers struct{ live map[uuid.UUID]bool }

func (s stubUsers) UserExists(_ context.Context, id uuid.UUID) (bool, error) {
	return s.live[id], nil
}

func (s stubUsers) GetUser(_ context.Context, id uuid.UUID) (*store.User, error) {
	if !s.live[id] {
		return nil, store.ErrUserNotFound
	}
	return &store.User{ID: id, Email: id.String() + "@example.test", DisplayName: "Stub"}, nil
}

func (s stubUsers) UpsertIdentity(_ context.Context, c store.IdentityClaims, _ uuid.UUID) (*store.User, error) {
	return &store.User{Email: c.Email, DisplayName: c.DisplayName}, nil
}

// "Save to my Drive" saves the same Markdown the download serves, under the
// notebook's own file name.
func TestSaveToMyDriveSavesTheExport(t *testing.T) {
	h := newHarness(t)
	nb := h.newNotebook(t, h.alice, "Week 3")
	h.newNote(t, h.alice, nb.ID, "Retrieval practice")
	resp := h.do(t, h.alice, http.MethodPost, "/v1/notebooks/"+nb.ID.String()+"/export/drive", nil)
	if got := status(t, resp); got != http.StatusCreated {
		t.Fatalf("status %d, want 201", got)
	}
	download := h.do(t, h.alice, http.MethodGet, "/v1/notebooks/"+nb.ID.String()+"/export.md", nil)
	md, _ := io.ReadAll(download.Body)
	download.Body.Close()
	if len(h.drive.Saved) != 1 || h.drive.Saved[0].Data != string(md) || h.drive.Saved[0].Key != "notebook:"+nb.ID.String() ||
		!strings.HasPrefix(h.drive.Saved[0].Name, "week-3 ") || !strings.HasSuffix(h.drive.Saved[0].Name, ".md") {
		t.Fatalf("saved %+v", h.drive.Saved)
	}
}
