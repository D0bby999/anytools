package notebook_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/notebook"
)

// fakeStore is an in-memory Store. The pg implementation is exercised against a
// real database in internal/store/pg; this one exists so the SERVICE's rules —
// which notebook a note lands in, who it says wrote it, what the export says —
// can be tested without one.
type fakeStore struct {
	notebooks  map[uuid.UUID]*notebook.Notebook
	notes      map[uuid.UUID]*notebook.Note
	categories map[uuid.UUID]*notebook.Category
	order      []uuid.UUID
	clock      time.Time
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		notebooks:  map[uuid.UUID]*notebook.Notebook{},
		notes:      map[uuid.UUID]*notebook.Note{},
		categories: map[uuid.UUID]*notebook.Category{},
		clock:      time.Date(2026, 9, 17, 8, 30, 0, 0, time.UTC),
	}
}

func (f *fakeStore) tick() time.Time {
	f.clock = f.clock.Add(time.Minute)
	return f.clock
}

func (f *fakeStore) CreateNotebook(_ context.Context, userID uuid.UUID, name string, isDefault bool) (*notebook.Notebook, error) {
	nb := &notebook.Notebook{ID: uuid.New(), UserID: userID, Name: name, IsDefault: isDefault, CreatedAt: f.tick()}
	f.notebooks[nb.ID] = nb
	return nb, nil
}

func (f *fakeStore) ListNotebooks(_ context.Context, userID uuid.UUID) ([]notebook.Notebook, error) {
	out := []notebook.Notebook{}
	for _, nb := range f.notebooks {
		if nb.UserID == userID {
			out = append(out, *nb)
		}
	}
	return out, nil
}

func (f *fakeStore) GetNotebook(_ context.Context, userID, id uuid.UUID) (*notebook.Notebook, error) {
	nb, ok := f.notebooks[id]
	if !ok || nb.UserID != userID {
		return nil, notebook.ErrNotFound
	}
	return nb, nil
}

func (f *fakeStore) RenameNotebook(ctx context.Context, userID, id uuid.UUID, name string) (*notebook.Notebook, error) {
	nb, err := f.GetNotebook(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	nb.Name = name
	return nb, nil
}

func (f *fakeStore) DeleteNotebook(ctx context.Context, userID, id uuid.UUID) error {
	if _, err := f.GetNotebook(ctx, userID, id); err != nil {
		return err
	}
	delete(f.notebooks, id)
	return nil
}

func (f *fakeStore) DefaultNotebook(_ context.Context, userID uuid.UUID) (*notebook.Notebook, error) {
	for _, nb := range f.notebooks {
		if nb.UserID == userID && nb.IsDefault {
			return nb, nil
		}
	}
	nb := &notebook.Notebook{ID: uuid.New(), UserID: userID, Name: "My notebook", IsDefault: true, CreatedAt: f.tick()}
	f.notebooks[nb.ID] = nb
	return nb, nil
}

func (f *fakeStore) CreateNote(_ context.Context, n notebook.Note) (*notebook.Note, error) {
	n.ID = uuid.New()
	n.CreatedAt = f.tick()
	n.UpdatedAt = n.CreatedAt
	f.notes[n.ID] = &n
	f.order = append(f.order, n.ID)
	return &n, nil
}

func (f *fakeStore) GetNote(_ context.Context, userID, id uuid.UUID) (*notebook.Note, error) {
	n, ok := f.notes[id]
	if !ok || n.UserID != userID {
		return nil, notebook.ErrNotFound
	}
	return n, nil
}

func (f *fakeStore) ListNotes(_ context.Context, userID, notebookID uuid.UUID, _ notebook.NoteFilter) ([]notebook.Note, error) {
	out := []notebook.Note{}
	for _, id := range f.order {
		n := f.notes[id]
		if n == nil || n.UserID != userID {
			continue
		}
		if notebookID != uuid.Nil && n.NotebookID != notebookID {
			continue
		}
		out = append(out, *n)
	}
	return out, nil
}

func (f *fakeStore) UpdateNote(ctx context.Context, userID, id uuid.UUID, patch notebook.NotePatch) (*notebook.Note, error) {
	n, err := f.GetNote(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if patch.Title != nil {
		n.Title = *patch.Title
	}
	if patch.BodyMD != nil {
		n.BodyMD = *patch.BodyMD
	}
	if patch.CategoryIDs != nil {
		n.CategoryIDs = *patch.CategoryIDs
	}
	return n, nil
}

func (f *fakeStore) DeleteNote(ctx context.Context, userID, id uuid.UUID) error {
	if _, err := f.GetNote(ctx, userID, id); err != nil {
		return err
	}
	delete(f.notes, id)
	return nil
}

func (f *fakeStore) MoveNote(ctx context.Context, userID, noteID, to uuid.UUID) (*notebook.Note, error) {
	n, err := f.GetNote(ctx, userID, noteID)
	if err != nil {
		return nil, err
	}
	n.NotebookID = to
	n.CategoryIDs = nil
	return n, nil
}

func (f *fakeStore) CreateCategory(_ context.Context, userID, notebookID uuid.UUID, name string) (*notebook.Category, error) {
	c := &notebook.Category{ID: uuid.New(), UserID: userID, NotebookID: notebookID, Name: name}
	f.categories[c.ID] = c
	return c, nil
}

func (f *fakeStore) ListCategories(_ context.Context, userID, notebookID uuid.UUID) ([]notebook.Category, error) {
	out := []notebook.Category{}
	for _, c := range f.categories {
		if c.UserID == userID && c.NotebookID == notebookID {
			out = append(out, *c)
		}
	}
	return out, nil
}

func (f *fakeStore) DeleteCategory(_ context.Context, userID, id uuid.UUID) error {
	c, ok := f.categories[id]
	if !ok || c.UserID != userID {
		return notebook.ErrNotFound
	}
	delete(f.categories, id)
	return nil
}

// ────────────────────────────────────────────────────────────────── tests

func TestWriteNoteFromTheAgentIsMarkedAsTheAgents(t *testing.T) {
	store := newFakeStore()
	svc := notebook.NewService(store)
	user, session := uuid.New(), uuid.New()

	id, err := svc.WriteNote(context.Background(), user, session, "RRF", "Reciprocal rank fusion merges two ranked lists.")
	if err != nil {
		t.Fatalf("WriteNote: %v", err)
	}
	noteID := uuid.MustParse(id)

	note, err := svc.GetNote(context.Background(), user, noteID)
	if err != nil {
		t.Fatalf("GetNote: %v", err)
	}
	if note.CreatedBy != notebook.CreatedByAgent {
		t.Fatalf("created_by = %q, want agent", note.CreatedBy)
	}
	if note.Source.Kind != notebook.SourceSession || note.Source.ID != session.String() {
		t.Fatalf("source = %+v, want the session", note.Source)
	}
	// It landed in the default notebook, which the tool did not have to name.
	nb, err := svc.DefaultNotebook(context.Background(), user)
	if err != nil {
		t.Fatalf("DefaultNotebook: %v", err)
	}
	if note.NotebookID != nb.ID {
		t.Fatalf("note went to %s, want the default notebook %s", note.NotebookID, nb.ID)
	}
}

func TestCreateNoteRejectsAnUnknownSourceKind(t *testing.T) {
	svc := notebook.NewService(newFakeStore())
	_, err := svc.CreateNote(context.Background(), uuid.New(), notebook.NewNote{
		Title:  "x",
		BodyMD: "y",
		Source: notebook.Source{Kind: "invoice", ID: "1"},
	})
	if !errors.Is(err, notebook.ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
}

// TestCopyNoteKeepsAuthorshipAndSource: filing a note somewhere else must not
// rewrite who wrote it or what page it came from.
func TestCopyNoteKeepsAuthorshipAndSource(t *testing.T) {
	store := newFakeStore()
	svc := notebook.NewService(store)
	ctx := context.Background()
	user := uuid.New()

	from, err := svc.CreateNotebook(ctx, user, "Reading")
	if err != nil {
		t.Fatalf("CreateNotebook: %v", err)
	}
	to, err := svc.CreateNotebook(ctx, user, "Revision")
	if err != nil {
		t.Fatalf("CreateNotebook: %v", err)
	}
	docID := uuid.New()
	original, err := svc.CreateNote(ctx, user, notebook.NewNote{
		NotebookID: from.ID, Title: "Equilibrium", BodyMD: "body",
		Source:    notebook.Source{Kind: notebook.SourceDocument, ID: docID.String(), Page: 14},
		CreatedBy: notebook.CreatedByAgent,
	})
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}

	copied, err := svc.CopyNote(ctx, user, original.ID, to.ID)
	if err != nil {
		t.Fatalf("CopyNote: %v", err)
	}
	if copied.ID == original.ID {
		t.Fatal("copy returned the original")
	}
	if copied.NotebookID != to.ID {
		t.Fatalf("copy landed in %s, want %s", copied.NotebookID, to.ID)
	}
	if copied.CreatedBy != notebook.CreatedByAgent {
		t.Fatalf("copy created_by = %q, want agent", copied.CreatedBy)
	}
	if copied.Source != original.Source {
		t.Fatalf("copy source = %+v, want %+v", copied.Source, original.Source)
	}
}

// TestExportCarriesTheDocumentIdAndPage is the acceptance criterion in one
// assertion: a notebook you can read outside AnyTools and still trace back to
// the page.
func TestExportCarriesTheDocumentIdAndPage(t *testing.T) {
	store := newFakeStore()
	svc := notebook.NewService(store)
	ctx := context.Background()
	user := uuid.New()

	nb, err := svc.CreateNotebook(ctx, user, "Chemistry 2026")
	if err != nil {
		t.Fatalf("CreateNotebook: %v", err)
	}
	cat, err := svc.CreateCategory(ctx, user, nb.ID, "Formulas")
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	docID := uuid.New()
	if _, err := svc.CreateNote(ctx, user, notebook.NewNote{
		NotebookID:  nb.ID,
		Title:       "Le Chatelier",
		BodyMD:      "A system at equilibrium opposes the change imposed on it.",
		Source:      notebook.Source{Kind: notebook.SourceDocument, ID: docID.String(), Page: 14},
		CreatedBy:   notebook.CreatedByAgent,
		CategoryIDs: []uuid.UUID{cat.ID},
	}); err != nil {
		t.Fatalf("CreateNote: %v", err)
	}

	md, err := svc.ExportMarkdown(ctx, user, nb.ID)
	if err != nil {
		t.Fatalf("ExportMarkdown: %v", err)
	}

	for _, want := range []string{
		"# Chemistry 2026",
		"## Le Chatelier",
		docID.String(),
		"page 14",
		"Written by: AnyLearn (agent)",
		"Categories: Formulas",
		"A system at equilibrium opposes the change imposed on it.",
	} {
		if !strings.Contains(md, want) {
			t.Errorf("export is missing %q\n---\n%s", want, md)
		}
	}
}

func TestExportOfAnEmptyNotebookSaysSo(t *testing.T) {
	svc := notebook.NewService(newFakeStore())
	ctx := context.Background()
	user := uuid.New()

	nb, err := svc.CreateNotebook(ctx, user, "Empty")
	if err != nil {
		t.Fatalf("CreateNotebook: %v", err)
	}
	md, err := svc.ExportMarkdown(ctx, user, nb.ID)
	if err != nil {
		t.Fatalf("ExportMarkdown: %v", err)
	}
	if !strings.Contains(md, "empty") {
		t.Fatalf("export = %q", md)
	}
}

// TestExportFilenameIsSafeInAHeader: the notebook's name reaches a
// Content-Disposition header, so a name that can close a quoted string or start
// a new line is a header-injection primitive.
func TestExportFilenameIsSafeInAHeader(t *testing.T) {
	cases := map[string]string{
		"Chemistry 2026":          "chemistry-2026.md",
		`x"; filename="evil.html`: "x-filename-evil-html.md",
		"line\r\nX-Injected: yes": "line-x-injected-yes.md",
		"../../etc/passwd":        "etc-passwd.md",
		"":                        "notebook.md",
		"—":                       "notebook.md",
	}
	for name, want := range cases {
		if got := notebook.ExportFilename(name); got != want {
			t.Errorf("ExportFilename(%q) = %q, want %q", name, got, want)
		}
	}
}

// TestSourceKindsMatchTheMigration guards the one list that is written twice:
// here in Go and as a CHECK constraint the database enforces.
func TestSourceKindsMatchTheMigration(t *testing.T) {
	want := []string{"session", "question", "document", "reading"}
	got := notebook.SourceKinds()
	if len(got) != len(want) {
		t.Fatalf("SourceKinds() = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("SourceKinds() = %v, want %v", got, want)
		}
	}
}
