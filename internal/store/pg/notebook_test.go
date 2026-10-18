package pg_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/notebook"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// notebookFixture is two users over one store. Two, always: a store test with
// one user proves the query runs, not that it is scoped, and RT-3 is precisely
// about queries that ran fine while returning somebody else's rows.
type notebookFixture struct {
	store *pg.NotebookStore
	alice uuid.UUID
	bob   uuid.UUID
}

func newNotebookFixture(t *testing.T) (context.Context, *notebookFixture) {
	t.Helper()
	pool := testutil.TestDB(t)
	return context.Background(), &notebookFixture{
		store: pg.NewNotebookStore(pool),
		alice: testutil.NewUser(t, pool),
		bob:   testutil.NewUser(t, pool),
	}
}

func TestNotebookCRUDRoundTrips(t *testing.T) {
	ctx, f := newNotebookFixture(t)

	nb, err := f.store.CreateNotebook(ctx, f.alice, "Chemistry", true)
	if err != nil {
		t.Fatalf("CreateNotebook: %v", err)
	}
	if !nb.IsDefault || nb.Name != "Chemistry" || nb.NoteCount != 0 {
		t.Fatalf("notebook = %+v", nb)
	}

	note, err := f.store.CreateNote(ctx, notebook.Note{
		UserID: f.alice, NotebookID: nb.ID,
		Title: "Le Chatelier", BodyMD: "Systems oppose the change imposed on them.",
		Source:    notebook.Source{Kind: notebook.SourceDocument, ID: uuid.NewString(), Page: 14},
		CreatedBy: notebook.CreatedByUser,
	})
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}
	if note.Source.Page != 14 {
		t.Fatalf("source page = %d, want 14", note.Source.Page)
	}

	read, err := f.store.GetNote(ctx, f.alice, note.ID)
	if err != nil {
		t.Fatalf("GetNote: %v", err)
	}
	if read.Source != note.Source {
		t.Fatalf("source round trip: %+v != %+v", read.Source, note.Source)
	}

	// The count is derived, not stored, so it cannot drift from the notes.
	after, err := f.store.GetNotebook(ctx, f.alice, nb.ID)
	if err != nil {
		t.Fatalf("GetNotebook: %v", err)
	}
	if after.NoteCount != 1 {
		t.Fatalf("note_count = %d, want 1", after.NoteCount)
	}
}

// TestDefaultNotebookIsCreatedOnceUnderConcurrency is the reason DefaultNotebook
// is one statement rather than a read followed by a write.
func TestDefaultNotebookIsCreatedOnceUnderConcurrency(t *testing.T) {
	ctx, f := newNotebookFixture(t)

	const racers = 6
	ids := make(chan uuid.UUID, racers)
	errs := make(chan error, racers)
	start := make(chan struct{})
	for i := 0; i < racers; i++ {
		go func() {
			<-start
			nb, err := f.store.DefaultNotebook(ctx, f.alice)
			if err != nil {
				errs <- err
				return
			}
			ids <- nb.ID
		}()
	}
	close(start)

	var first uuid.UUID
	for i := 0; i < racers; i++ {
		select {
		case err := <-errs:
			t.Fatalf("DefaultNotebook: %v", err)
		case id := <-ids:
			if first == uuid.Nil {
				first = id
			} else if id != first {
				t.Fatalf("two default notebooks: %s and %s", first, id)
			}
		}
	}

	all, err := f.store.ListNotebooks(ctx, f.alice)
	if err != nil {
		t.Fatalf("ListNotebooks: %v", err)
	}
	if len(all) != 1 {
		t.Fatalf("%d notebooks, want 1", len(all))
	}
}

// TestNotebookStoreIsolatesUsers walks every read and write with the OTHER
// user's id and requires ErrNotFound from each.
func TestNotebookStoreIsolatesUsers(t *testing.T) {
	ctx, f := newNotebookFixture(t)

	nb, err := f.store.CreateNotebook(ctx, f.alice, "Alice's", true)
	if err != nil {
		t.Fatalf("CreateNotebook: %v", err)
	}
	cat, err := f.store.CreateCategory(ctx, f.alice, nb.ID, "Formulas")
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	note, err := f.store.CreateNote(ctx, notebook.Note{
		UserID: f.alice, NotebookID: nb.ID, Title: "Private", BodyMD: "secret",
		CreatedBy: notebook.CreatedByUser, CategoryIDs: []uuid.UUID{cat.ID},
	})
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}
	bobBook, err := f.store.CreateNotebook(ctx, f.bob, "Bob's", true)
	if err != nil {
		t.Fatalf("CreateNotebook(bob): %v", err)
	}

	probes := map[string]func() error{
		"GetNotebook": func() error {
			_, err := f.store.GetNotebook(ctx, f.bob, nb.ID)
			return err
		},
		"RenameNotebook": func() error {
			_, err := f.store.RenameNotebook(ctx, f.bob, nb.ID, "stolen")
			return err
		},
		"DeleteNotebook": func() error { return f.store.DeleteNotebook(ctx, f.bob, nb.ID) },
		"GetNote": func() error {
			_, err := f.store.GetNote(ctx, f.bob, note.ID)
			return err
		},
		"UpdateNote": func() error {
			body := "rewritten"
			_, err := f.store.UpdateNote(ctx, f.bob, note.ID, notebook.NotePatch{BodyMD: &body})
			return err
		},
		"DeleteNote":     func() error { return f.store.DeleteNote(ctx, f.bob, note.ID) },
		"DeleteCategory": func() error { return f.store.DeleteCategory(ctx, f.bob, cat.ID) },
		"MoveNote": func() error {
			_, err := f.store.MoveNote(ctx, f.bob, note.ID, bobBook.ID)
			return err
		},
	}
	for name, probe := range probes {
		if err := probe(); !errors.Is(err, notebook.ErrNotFound) {
			t.Errorf("%s as the wrong user: err = %v, want ErrNotFound", name, err)
		}
	}

	// Listing is the other half: it must not error, it must return nothing.
	if notes, err := f.store.ListNotes(ctx, f.bob, nb.ID, notebook.NoteFilter{}); err != nil {
		t.Fatalf("ListNotes(bob): %v", err)
	} else if len(notes) != 0 {
		t.Fatalf("bob saw %d of alice's notes", len(notes))
	}
	if cats, err := f.store.ListCategories(ctx, f.bob, nb.ID); err != nil {
		t.Fatalf("ListCategories(bob): %v", err)
	} else if len(cats) != 0 {
		t.Fatalf("bob saw %d of alice's categories", len(cats))
	}

	// And alice's rows survived every one of bob's attempts.
	if _, err := f.store.GetNote(ctx, f.alice, note.ID); err != nil {
		t.Fatalf("alice lost her note to bob's probes: %v", err)
	}
}

// TestMoveNoteRejectsAForeignDestination pins the half of move that a
// user_id filter on the SOURCE row alone would not catch.
func TestMoveNoteRejectsAForeignDestination(t *testing.T) {
	ctx, f := newNotebookFixture(t)

	alicesBook, err := f.store.CreateNotebook(ctx, f.alice, "Alice's", true)
	if err != nil {
		t.Fatalf("CreateNotebook: %v", err)
	}
	bobsBook, err := f.store.CreateNotebook(ctx, f.bob, "Bob's", true)
	if err != nil {
		t.Fatalf("CreateNotebook(bob): %v", err)
	}
	note, err := f.store.CreateNote(ctx, notebook.Note{
		UserID: f.alice, NotebookID: alicesBook.ID, Title: "Mine", BodyMD: "x",
		CreatedBy: notebook.CreatedByUser,
	})
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}

	if _, err := f.store.MoveNote(ctx, f.alice, note.ID, bobsBook.ID); !errors.Is(err, notebook.ErrNotFound) {
		t.Fatalf("move into bob's notebook: err = %v, want ErrNotFound", err)
	}
	still, err := f.store.GetNote(ctx, f.alice, note.ID)
	if err != nil {
		t.Fatalf("GetNote: %v", err)
	}
	if still.NotebookID != alicesBook.ID {
		t.Fatalf("the note moved anyway: notebook = %s", still.NotebookID)
	}
}

// TestMoveNoteDropsCategories: a category belongs to ONE notebook, so carrying
// the links across would file the note under labels the destination lacks.
func TestMoveNoteDropsCategories(t *testing.T) {
	ctx, f := newNotebookFixture(t)

	from, err := f.store.CreateNotebook(ctx, f.alice, "From", true)
	if err != nil {
		t.Fatalf("CreateNotebook: %v", err)
	}
	to, err := f.store.CreateNotebook(ctx, f.alice, "To", false)
	if err != nil {
		t.Fatalf("CreateNotebook: %v", err)
	}
	cat, err := f.store.CreateCategory(ctx, f.alice, from.ID, "Formulas")
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	note, err := f.store.CreateNote(ctx, notebook.Note{
		UserID: f.alice, NotebookID: from.ID, Title: "n", BodyMD: "b",
		CreatedBy: notebook.CreatedByUser, CategoryIDs: []uuid.UUID{cat.ID},
	})
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}

	moved, err := f.store.MoveNote(ctx, f.alice, note.ID, to.ID)
	if err != nil {
		t.Fatalf("MoveNote: %v", err)
	}
	if len(moved.CategoryIDs) != 0 {
		t.Fatalf("categories survived the move: %v", moved.CategoryIDs)
	}
	reread, err := f.store.GetNote(ctx, f.alice, note.ID)
	if err != nil {
		t.Fatalf("GetNote: %v", err)
	}
	if len(reread.CategoryIDs) != 0 {
		t.Fatalf("categories survived the move in the database: %v", reread.CategoryIDs)
	}
}

// TestListNotesFiltersByDocument is the reading pane's own query — "the notes I
// already took on this document" — and is what the GIN index on `source` serves.
func TestListNotesFiltersByDocument(t *testing.T) {
	ctx, f := newNotebookFixture(t)

	nb, err := f.store.CreateNotebook(ctx, f.alice, "Reading", true)
	if err != nil {
		t.Fatalf("CreateNotebook: %v", err)
	}
	wanted := uuid.New()
	other := uuid.New()

	for _, docID := range []uuid.UUID{wanted, other, wanted} {
		if _, err := f.store.CreateNote(ctx, notebook.Note{
			UserID: f.alice, NotebookID: nb.ID, Title: "n", BodyMD: "b",
			Source:    notebook.Source{Kind: notebook.SourceDocument, ID: docID.String(), Page: 3},
			CreatedBy: notebook.CreatedByAgent,
		}); err != nil {
			t.Fatalf("CreateNote: %v", err)
		}
	}

	// Across notebooks (uuid.Nil), which is how the pane asks.
	got, err := f.store.ListNotes(ctx, f.alice, uuid.Nil, notebook.NoteFilter{DocumentID: &wanted})
	if err != nil {
		t.Fatalf("ListNotes: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("%d notes for the document, want 2", len(got))
	}
	for _, n := range got {
		if n.Source.ID != wanted.String() {
			t.Fatalf("filter leaked note from %s", n.Source.ID)
		}
	}
}

// TestCategoryLinksRefuseAForeignCategory pins the composite foreign key on
// note_category_links: the DATABASE refuses, not the handler.
func TestCategoryLinksRefuseAForeignCategory(t *testing.T) {
	ctx, f := newNotebookFixture(t)

	alicesBook, err := f.store.CreateNotebook(ctx, f.alice, "Alice's", true)
	if err != nil {
		t.Fatalf("CreateNotebook: %v", err)
	}
	bobsBook, err := f.store.CreateNotebook(ctx, f.bob, "Bob's", true)
	if err != nil {
		t.Fatalf("CreateNotebook(bob): %v", err)
	}
	bobsCat, err := f.store.CreateCategory(ctx, f.bob, bobsBook.ID, "Bob's label")
	if err != nil {
		t.Fatalf("CreateCategory(bob): %v", err)
	}

	_, err = f.store.CreateNote(ctx, notebook.Note{
		UserID: f.alice, NotebookID: alicesBook.ID, Title: "n", BodyMD: "b",
		CreatedBy: notebook.CreatedByUser, CategoryIDs: []uuid.UUID{bobsCat.ID},
	})
	if err == nil {
		t.Fatal("alice filed a note under bob's category")
	}
}
