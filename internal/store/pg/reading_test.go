package pg_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/capabilities/reading"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// readingFixture is two users, each with a knowledge base and one document, so
// every isolation probe has a REAL row of the other user's to aim at. Probing
// with a random uuid would only prove the query returns nothing for ids that do
// not exist, which is not the property being tested.
type readingFixture struct {
	pool     *pgxpool.Pool
	store    *pg.ReadingStore
	alice    uuid.UUID
	bob      uuid.UUID
	aliceDoc uuid.UUID
	bobDoc   uuid.UUID
}

func newReadingFixture(t *testing.T) (context.Context, *readingFixture) {
	t.Helper()
	pool := testutil.TestDB(t)
	ctx := context.Background()

	f := &readingFixture{
		pool:  pool,
		store: pg.NewReadingStore(pool),
		alice: testutil.NewUser(t, pool),
		bob:   testutil.NewUser(t, pool),
	}
	f.aliceDoc = seedReadingDocument(t, ctx, pool, f.alice)
	f.bobDoc = seedReadingDocument(t, ctx, pool, f.bob)
	return ctx, f
}

// seedReadingDocument creates a knowledge base and a document for one user.
func seedReadingDocument(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) uuid.UUID {
	t.Helper()
	store := pg.NewKnowledgeStore(pool)
	kb, err := store.CreateKB(ctx, userID, "Reading test")
	if err != nil {
		t.Fatalf("CreateKB: %v", err)
	}
	doc, err := store.CreateDocument(ctx, knowledge.Document{
		UserID: userID, KBID: kb.ID, SourceKind: "upload",
		Title: "Chapter 3.pdf", MIME: "application/pdf", Bytes: 12,
		// A syntactically valid sha256; the blob is not needed by these tests.
		SHA256:    strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""),
		PageCount: 20,
	})
	if err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}
	return doc.ID
}

func TestReadingWorkspaceIsCreatedOnceAndResumes(t *testing.T) {
	ctx, f := newReadingFixture(t)

	first, err := f.store.EnsureWorkspace(ctx, f.alice, f.aliceDoc)
	if err != nil {
		t.Fatalf("EnsureWorkspace: %v", err)
	}
	second, err := f.store.EnsureWorkspace(ctx, f.alice, f.aliceDoc)
	if err != nil {
		t.Fatalf("EnsureWorkspace (again): %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("two workspaces for one document: %s and %s", first.ID, second.ID)
	}

	if _, err := f.store.SetProgress(ctx, f.alice, first.ID,
		reading.Progress{Page: 14, Percent: 0.42}); err != nil {
		t.Fatalf("SetProgress: %v", err)
	}

	// "Resume where I left off" is this line: a later open returns the progress.
	resumed, err := f.store.EnsureWorkspace(ctx, f.alice, f.aliceDoc)
	if err != nil {
		t.Fatalf("EnsureWorkspace (resume): %v", err)
	}
	if resumed.Progress.Page != 14 || resumed.Progress.Percent != 0.42 {
		t.Fatalf("progress = %+v, want page 14 / 0.42", resumed.Progress)
	}
}

// TestEnsureWorkspaceIsSafeUnderConcurrency: two tabs opened at once must not
// turn the unique constraint into a failed page load.
func TestEnsureWorkspaceIsSafeUnderConcurrency(t *testing.T) {
	ctx, f := newReadingFixture(t)

	const racers = 6
	ids := make(chan uuid.UUID, racers)
	errs := make(chan error, racers)
	start := make(chan struct{})
	for i := 0; i < racers; i++ {
		go func() {
			<-start
			ws, err := f.store.EnsureWorkspace(ctx, f.alice, f.aliceDoc)
			if err != nil {
				errs <- err
				return
			}
			ids <- ws.ID
		}()
	}
	close(start)

	var first uuid.UUID
	for i := 0; i < racers; i++ {
		select {
		case err := <-errs:
			t.Fatalf("EnsureWorkspace: %v", err)
		case id := <-ids:
			if first == uuid.Nil {
				first = id
			} else if id != first {
				t.Fatalf("two workspaces: %s and %s", first, id)
			}
		}
	}
}

// TestAttachSessionKeepsTheFirstWinner: two selection actions fired together
// must share one conversation, not orphan one of the turns.
func TestAttachSessionKeepsTheFirstWinner(t *testing.T) {
	ctx, f := newReadingFixture(t)

	ws, err := f.store.EnsureWorkspace(ctx, f.alice, f.aliceDoc)
	if err != nil {
		t.Fatalf("EnsureWorkspace: %v", err)
	}
	chat := pg.NewChatStore(f.pool)
	one, err := chat.CreateSession(ctx, runtimeSession(f.alice, "one"))
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	two, err := chat.CreateSession(ctx, runtimeSession(f.alice, "two"))
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	if _, err := f.store.AttachSession(ctx, f.alice, ws.ID, one.ID); err != nil {
		t.Fatalf("AttachSession: %v", err)
	}
	after, err := f.store.AttachSession(ctx, f.alice, ws.ID, two.ID)
	if err != nil {
		t.Fatalf("AttachSession (second): %v", err)
	}
	if after.SessionID == nil || *after.SessionID != one.ID {
		t.Fatalf("session = %v, want the first winner %s", after.SessionID, one.ID)
	}
}

func TestReadingStoreIsolatesUsers(t *testing.T) {
	ctx, f := newReadingFixture(t)

	ws, err := f.store.EnsureWorkspace(ctx, f.alice, f.aliceDoc)
	if err != nil {
		t.Fatalf("EnsureWorkspace: %v", err)
	}
	hl, err := f.store.CreateHighlight(ctx, reading.Highlight{
		UserID: f.alice, WorkspaceID: ws.ID, Page: 14, Text: "private passage", Color: "yellow",
	})
	if err != nil {
		t.Fatalf("CreateHighlight: %v", err)
	}

	probes := map[string]func() error{
		"GetWorkspace": func() error {
			_, err := f.store.GetWorkspace(ctx, f.bob, ws.ID)
			return err
		},
		"SetProgress": func() error {
			_, err := f.store.SetProgress(ctx, f.bob, ws.ID, reading.Progress{Page: 99})
			return err
		},
		"DeleteWorkspace": func() error { return f.store.DeleteWorkspace(ctx, f.bob, ws.ID) },
		"GetHighlight": func() error {
			_, err := f.store.GetHighlight(ctx, f.bob, hl.ID)
			return err
		},
		"UpdateHighlight": func() error {
			c := "pink"
			_, err := f.store.UpdateHighlight(ctx, f.bob, hl.ID, reading.HighlightPatch{Color: &c})
			return err
		},
		"DeleteHighlight": func() error { return f.store.DeleteHighlight(ctx, f.bob, hl.ID) },
		"AttachSession": func() error {
			_, err := f.store.AttachSession(ctx, f.bob, ws.ID, uuid.New())
			return err
		},
	}
	for name, probe := range probes {
		if err := probe(); !errors.Is(err, reading.ErrNotFound) {
			t.Errorf("%s as the wrong user: err = %v, want ErrNotFound", name, err)
		}
	}

	if list, err := f.store.ListHighlights(ctx, f.bob, ws.ID); err != nil {
		t.Fatalf("ListHighlights(bob): %v", err)
	} else if len(list) != 0 {
		t.Fatalf("bob saw %d of alice's highlights", len(list))
	}
	if list, err := f.store.ListWorkspaces(ctx, f.bob, 50); err != nil {
		t.Fatalf("ListWorkspaces(bob): %v", err)
	} else {
		for _, w := range list {
			if w.ID == ws.ID {
				t.Fatal("alice's workspace appeared in bob's list")
			}
		}
	}

	if _, err := f.store.GetWorkspace(ctx, f.alice, ws.ID); err != nil {
		t.Fatalf("alice lost her workspace to bob's probes: %v", err)
	}
}

// TestWorkspaceRefusesAForeignDocument pins the composite foreign key: a
// workspace cannot be created over another user's document even if a caller
// skipped the handler's authorization.
func TestWorkspaceRefusesAForeignDocument(t *testing.T) {
	ctx, f := newReadingFixture(t)

	if _, err := f.store.EnsureWorkspace(ctx, f.alice, f.bobDoc); err == nil {
		t.Fatal("alice opened a workspace over bob's document")
	}
}

// runtimeSession is the minimum a chat session row needs to exist.
func runtimeSession(userID uuid.UUID, title string) runtime.Session {
	return runtime.Session{UserID: userID, Title: title, KBIDs: []uuid.UUID{}}
}
