package pg_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/rag/embed"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// makeUser inserts a user and registers its cleanup. Everything below cascades
// from users, so deleting the user is the whole teardown.
func makeUser(t *testing.T, pool *pgxpool.Pool, label string) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var id uuid.UUID
	email := label + "-" + uuid.NewString() + "@example.test"
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id`,
		email, label).Scan(&id); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func seedDocument(t *testing.T, store *pg.KnowledgeStore, userID, kbID uuid.UUID, title string) *knowledge.Document {
	t.Helper()
	// A digest unique per document: two documents in one knowledge base must
	// not collide on documents_kb_sha_unique, which is a real constraint and
	// not this helper's business to trip over.
	doc, err := store.CreateDocument(context.Background(), knowledge.Document{
		UserID: userID, KBID: kbID, SourceKind: knowledge.SourceUpload,
		Title: title, MIME: "application/pdf", Bytes: 1234,
		SHA256:    strings.ReplaceAll(uuid.NewString(), "-", "") + strings.ReplaceAll(uuid.NewString(), "-", ""),
		PageCount: 3,
	})
	if err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}
	return doc
}

func seedChunk(t *testing.T, chunks *pg.ChunkStore, userID, kbID, docID uuid.UUID, text string) {
	t.Helper()
	vec := make([]float32, embed.StorageDims)
	vec[0] = 1
	if err := chunks.ReplaceDocumentChunks(context.Background(), userID, kbID, docID,
		[]knowledge.StoredChunk{{
			Ord: 0, HeadingPath: "Doc > Section", PageStart: 1, PageEnd: 1,
			Text: text, Embedding: vec, Dims: 1536,
		}}); err != nil {
		t.Fatalf("ReplaceDocumentChunks: %v", err)
	}
}

// ── isolation ──────────────────────────────────────────────────────────────

// The red-team RT-3 test: A cannot see B's knowledge base, document or chunk
// through ANY store method, and the answer is always "not found" rather than
// "forbidden".
func TestUserIsolationAcrossEveryStoreMethod(t *testing.T) {
	pool := testutil.TestDB(t)
	store := pg.NewKnowledgeStore(pool)
	chunks := pg.NewChunkStore(pool)
	ctx := context.Background()

	alice := makeUser(t, pool, "alice")
	bob := makeUser(t, pool, "bob")

	bobKB, err := store.CreateKB(ctx, bob, "Bob's private research")
	if err != nil {
		t.Fatalf("CreateKB: %v", err)
	}
	bobDoc := seedDocument(t, store, bob, bobKB.ID, "bob-secret.pdf")
	seedChunk(t, chunks, bob, bobKB.ID, bobDoc.ID, "bob's confidential passage about mergers")

	aliceKB, err := store.CreateKB(ctx, alice, "Alice's notes")
	if err != nil {
		t.Fatalf("CreateKB: %v", err)
	}

	t.Run("GetKB", func(t *testing.T) {
		if _, err := store.GetKB(ctx, alice, bobKB.ID); !errors.Is(err, authz.ErrNoAccess) {
			t.Fatalf("err = %v, want ErrNoAccess", err)
		}
	})

	t.Run("ListKBs", func(t *testing.T) {
		kbs, err := store.ListKBs(ctx, alice)
		if err != nil {
			t.Fatalf("ListKBs: %v", err)
		}
		for _, s := range kbs {
			if s.KB.ID == bobKB.ID {
				t.Fatal("bob's knowledge base appeared in alice's list")
			}
		}
	})

	t.Run("DeleteKB", func(t *testing.T) {
		if err := store.DeleteKB(ctx, alice, bobKB.ID); !errors.Is(err, authz.ErrNoAccess) {
			t.Fatalf("err = %v, want ErrNoAccess", err)
		}
		if _, err := store.GetKB(ctx, bob, bobKB.ID); err != nil {
			t.Fatalf("bob's KB was deleted by alice's request: %v", err)
		}
	})

	t.Run("ListDocuments", func(t *testing.T) {
		docs, err := store.ListDocuments(ctx, alice, bobKB.ID)
		if err != nil {
			t.Fatalf("ListDocuments: %v", err)
		}
		if len(docs) != 0 {
			t.Fatalf("alice sees %d of bob's documents", len(docs))
		}
	})

	t.Run("GetDocument", func(t *testing.T) {
		if _, err := store.GetDocument(ctx, alice, bobDoc.ID); !errors.Is(err, authz.ErrNoAccess) {
			t.Fatalf("err = %v, want ErrNoAccess", err)
		}
	})

	t.Run("SetDocumentStatus", func(t *testing.T) {
		err := store.SetDocumentStatus(ctx, alice, bobDoc.ID, knowledge.StatusFailed, "sabotage")
		if !errors.Is(err, authz.ErrNoAccess) {
			t.Fatalf("err = %v, want ErrNoAccess", err)
		}
		doc, err := store.GetDocument(ctx, bob, bobDoc.ID)
		if err != nil {
			t.Fatalf("GetDocument: %v", err)
		}
		if doc.Status == knowledge.StatusFailed {
			t.Fatal("alice changed the status of bob's document")
		}
	})

	t.Run("DeleteDocument", func(t *testing.T) {
		if err := store.DeleteDocument(ctx, alice, bobKB.ID, bobDoc.ID); !errors.Is(err, authz.ErrNoAccess) {
			t.Fatalf("err = %v, want ErrNoAccess", err)
		}
		// And not by naming her own KB either.
		if err := store.DeleteDocument(ctx, alice, aliceKB.ID, bobDoc.ID); !errors.Is(err, authz.ErrNoAccess) {
			t.Fatalf("err = %v, want ErrNoAccess", err)
		}
		if _, err := store.GetDocument(ctx, bob, bobDoc.ID); err != nil {
			t.Fatalf("bob's document was deleted: %v", err)
		}
	})

	t.Run("PinEmbeddingRoute", func(t *testing.T) {
		if err := store.PinEmbeddingRoute(ctx, alice, bobKB.ID, "evil-model", 768); !errors.Is(err, authz.ErrNoAccess) {
			t.Fatalf("err = %v, want ErrNoAccess", err)
		}
	})

	t.Run("chunks", func(t *testing.T) {
		got, err := chunks.ChunkTexts(ctx, alice, bobDoc.ID)
		if err != nil {
			t.Fatalf("ChunkTexts: %v", err)
		}
		if len(got) != 0 {
			t.Fatalf("alice read %d of bob's chunks", len(got))
		}
		n, err := chunks.CountChunks(ctx, alice, bobKB.ID)
		if err != nil {
			t.Fatalf("CountChunks: %v", err)
		}
		if n != 0 {
			t.Fatalf("alice counted %d of bob's chunks", n)
		}
		if err := chunks.DeleteDocumentChunks(ctx, alice, bobDoc.ID); err != nil {
			t.Fatalf("DeleteDocumentChunks: %v", err)
		}
		still, err := chunks.CountChunks(ctx, bob, bobKB.ID)
		if err != nil {
			t.Fatalf("CountChunks: %v", err)
		}
		if still != 1 {
			t.Fatal("alice deleted bob's chunks")
		}
	})

	t.Run("authz lookups", func(t *testing.T) {
		a := authz.New(store)
		if err := a.OwnsKB(ctx, alice, bobKB.ID); !errors.Is(err, authz.ErrNoAccess) {
			t.Fatalf("OwnsKB err = %v", err)
		}
		if _, err := a.OwnsDocument(ctx, alice, bobDoc.ID); !errors.Is(err, authz.ErrNoAccess) {
			t.Fatalf("OwnsDocument err = %v", err)
		}
	})
}

// The composite foreign keys make cross-tenant writes IMPOSSIBLE, not merely
// forbidden: an application bug that passes the wrong kb_id gets a constraint
// violation rather than a cross-tenant row.
func TestDatabaseRefusesACrossTenantChild(t *testing.T) {
	pool := testutil.TestDB(t)
	store := pg.NewKnowledgeStore(pool)
	ctx := context.Background()

	alice := makeUser(t, pool, "alice")
	bob := makeUser(t, pool, "bob")
	bobKB, err := store.CreateKB(ctx, bob, "Bob's KB")
	if err != nil {
		t.Fatalf("CreateKB: %v", err)
	}

	// Alice's user_id with Bob's kb_id: the (kb_id, user_id) foreign key has no
	// such parent row.
	_, err = store.CreateDocument(ctx, knowledge.Document{
		UserID: alice, KBID: bobKB.ID, SourceKind: knowledge.SourceUpload,
		Title: "smuggled.pdf", MIME: "application/pdf", Bytes: 1,
		SHA256: strings.Repeat("b", 64), PageCount: 1,
	})
	if err == nil {
		t.Fatal("the database accepted a document in another user's knowledge base")
	}
	if !strings.Contains(err.Error(), "documents_kb_same_owner") {
		t.Fatalf("expected the composite foreign key to refuse it, got %v", err)
	}
}

// ── schema invariants the spikes locked ────────────────────────────────────

// Spike D: one global HNSW post-filtered by kb_id measured recall 0.000 for a
// small KB. The partial index is created WITH the KB, so this asserts the
// lifecycle rather than the query plan.
func TestPartialHNSWIndexIsCreatedWithTheKBAndDroppedWithIt(t *testing.T) {
	pool := testutil.TestDB(t)
	store := pg.NewKnowledgeStore(pool)
	ctx := context.Background()

	user := makeUser(t, pool, "indexer")
	kb, err := store.CreateKB(ctx, user, "Indexed KB")
	if err != nil {
		t.Fatalf("CreateKB: %v", err)
	}

	exists, err := pg.HasKBVectorIndex(ctx, pool, kb.ID)
	if err != nil {
		t.Fatalf("HasKBVectorIndex: %v", err)
	}
	if !exists {
		t.Fatal("a knowledge base must get its partial HNSW index at creation")
	}

	if err := store.DeleteKB(ctx, user, kb.ID); err != nil {
		t.Fatalf("DeleteKB: %v", err)
	}
	exists, err = pg.HasKBVectorIndex(ctx, pool, kb.ID)
	if err != nil {
		t.Fatalf("HasKBVectorIndex: %v", err)
	}
	if exists {
		t.Fatal("the partial index must go with its knowledge base")
	}
}

// There must be NO global HNSW on chunks. Spike D measured it at recall 0.000
// for the case that matters, and having one would also let the planner pick it.
func TestNoGlobalHNSWIndexExists(t *testing.T) {
	pool := testutil.TestDB(t)
	rows, err := pool.Query(context.Background(), `
        SELECT i.relname, pg_get_indexdef(i.oid)
        FROM pg_class i
        JOIN pg_index x ON x.indexrelid = i.oid
        JOIN pg_class t ON t.oid = x.indrelid
        JOIN pg_am am ON am.oid = i.relam
        WHERE t.relname = 'chunks' AND am.amname = 'hnsw'`)
	if err != nil {
		t.Fatalf("query indexes: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var name, def string
		if err := rows.Scan(&name, &def); err != nil {
			t.Fatalf("scan: %v", err)
		}
		if !strings.Contains(def, "WHERE") {
			t.Fatalf("index %s is a GLOBAL hnsw index: %s\n"+
				"Spike D measured recall 0.000 for a small KB inside one of these", name, def)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
}

// The btree Spike D says to keep: with it the planner does btree + exact sort
// for a small KB (recall 1.000, 1.33 ms).
func TestBtreeOnKBIDExists(t *testing.T) {
	pool := testutil.TestDB(t)
	var exists bool
	err := pool.QueryRow(context.Background(),
		`SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'chunks_kb_id_idx')`).Scan(&exists)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if !exists {
		t.Fatal("chunks_kb_id_idx is what makes the planner's exact path cheap")
	}
}

// halfvec(3072) really does reject a 1536-wide vector — the red-team claim,
// re-proved against this schema so the padding rule cannot be quietly dropped.
func TestHalfvecColumnRejectsAnUnpaddedVector(t *testing.T) {
	pool := testutil.TestDB(t)
	store := pg.NewKnowledgeStore(pool)
	chunks := pg.NewChunkStore(pool)
	ctx := context.Background()

	user := makeUser(t, pool, "padder")
	kb, err := store.CreateKB(ctx, user, "Padding KB")
	if err != nil {
		t.Fatalf("CreateKB: %v", err)
	}
	doc := seedDocument(t, store, user, kb.ID, "doc.pdf")

	// The store refuses before the database has to.
	short := make([]float32, 1536)
	err = chunks.ReplaceDocumentChunks(ctx, user, kb.ID, doc.ID, []knowledge.StoredChunk{{
		Ord: 0, PageStart: 1, PageEnd: 1, Text: "x", Embedding: short, Dims: 1536,
	}})
	if err == nil || !strings.Contains(err.Error(), "pad before writing") {
		t.Fatalf("err = %v, want a refusal naming the padding rule", err)
	}

	// And the column itself refuses, which is the invariant the store's check
	// is only a friendlier version of.
	_, err = pool.Exec(ctx, `
        INSERT INTO chunks (user_id, kb_id, document_id, ord, page_start, page_end, text, embedding, dims)
        VALUES ($1, $2, $3, 0, 1, 1, 'x', $4::halfvec(3072), 1536)`,
		user, kb.ID, doc.ID, embed.Literal(short))
	if err == nil {
		t.Fatal("halfvec(3072) accepted a 1536-wide vector")
	}
	if !strings.Contains(err.Error(), "3072") {
		t.Fatalf("expected a dimension error, got %v", err)
	}
}

// The tsv column is GENERATED with 'english'. Spike D: english beat 'simple'
// 14-0 with 6 ties over 20 morphological probes.
func TestTSVIsGeneratedWithEnglish(t *testing.T) {
	pool := testutil.TestDB(t)
	var def string
	err := pool.QueryRow(context.Background(), `
        SELECT pg_get_expr(d.adbin, d.adrelid)
        FROM pg_attrdef d
        JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
        JOIN pg_class c ON c.oid = d.adrelid
        WHERE c.relname = 'chunks' AND a.attname = 'tsv'`).Scan(&def)
	if err != nil {
		t.Fatalf("read generated expression: %v", err)
	}
	if !strings.Contains(def, "english") {
		t.Fatalf("tsv is generated as %q — Spike D locked 'english'", def)
	}
}

// ── document lifecycle ─────────────────────────────────────────────────────

func TestDocumentStatusTransitionsAndProvenance(t *testing.T) {
	pool := testutil.TestDB(t)
	store := pg.NewKnowledgeStore(pool)
	ctx := context.Background()

	user := makeUser(t, pool, "lifecycle")
	kb, err := store.CreateKB(ctx, user, "Lifecycle KB")
	if err != nil {
		t.Fatalf("CreateKB: %v", err)
	}
	doc := seedDocument(t, store, user, kb.ID, "doc.pdf")

	for _, s := range []string{knowledge.StatusParsing, knowledge.StatusIndexing} {
		if err := store.SetDocumentStatus(ctx, user, doc.ID, s, ""); err != nil {
			t.Fatalf("SetDocumentStatus(%s): %v", s, err)
		}
	}

	if err := store.FinishDocument(ctx, user, doc.ID, 12,
		knowledge.ProcessedBy{Parser: "gemini", Model: "gemini-3.6-flash", Downgraded: true},
		"/data/parsed/x-v1.md"); err != nil {
		t.Fatalf("FinishDocument: %v", err)
	}

	got, err := store.GetDocument(ctx, user, doc.ID)
	if err != nil {
		t.Fatalf("GetDocument: %v", err)
	}
	if got.Status != knowledge.StatusReady || got.PageCount != 12 {
		t.Fatalf("doc = %+v", got)
	}
	if !strings.Contains(string(got.ProcessedBy), "gemini-3.6-flash") {
		t.Fatalf("processed_by = %s", got.ProcessedBy)
	}
	if got.Error != "" {
		t.Fatalf("a ready document must not carry an error: %q", got.Error)
	}
}

// A failed document must say why. The constraint makes a silent failure
// unrepresentable, and the store fills in a reason rather than violating it.
func TestFailedDocumentAlwaysCarriesAReason(t *testing.T) {
	pool := testutil.TestDB(t)
	store := pg.NewKnowledgeStore(pool)
	ctx := context.Background()

	user := makeUser(t, pool, "failer")
	kb, _ := store.CreateKB(ctx, user, "Failing KB")
	doc := seedDocument(t, store, user, kb.ID, "doc.pdf")

	if err := store.SetDocumentStatus(ctx, user, doc.ID, knowledge.StatusFailed, ""); err != nil {
		t.Fatalf("SetDocumentStatus: %v", err)
	}
	got, _ := store.GetDocument(ctx, user, doc.ID)
	if got.Error == "" {
		t.Fatal("a failed document with no reason is a dead end for the user")
	}
}

// A worker whose lease the reaper already took must not be able to drag a
// finished document back into a working state.
//
// The window is real. The reaper takes a job back when its lease expires, but
// the worker that held it only learns so at its next heartbeat — up to a third
// of a lease later. If that reap was TERMINAL, the reaper has already written
// `failed` and the job is gone; a late `SetDocumentStatus(parsing)` from the
// zombie then leaves a document in a working state with nothing running and
// nothing left to recover it. That is exactly the stuck-document failure RT-8
// named, arriving through the machinery built to prevent it.
func TestATerminalDocumentCannotBeDraggedBackIntoAWorkingState(t *testing.T) {
	pool := testutil.TestDB(t)
	store := pg.NewKnowledgeStore(pool)
	ctx := context.Background()

	user := makeUser(t, pool, "zombie")
	kb, err := store.CreateKB(ctx, user, "Zombie KB")
	if err != nil {
		t.Fatalf("CreateKB: %v", err)
	}

	for _, terminal := range []string{knowledge.StatusFailed, knowledge.StatusReady} {
		t.Run(terminal, func(t *testing.T) {
			doc := seedDocument(t, store, user, kb.ID, "doc-"+terminal+".pdf")

			switch terminal {
			case knowledge.StatusFailed:
				if err := store.SetDocumentStatus(ctx, user, doc.ID, knowledge.StatusFailed,
					"the worker processing this document stopped unexpectedly"); err != nil {
					t.Fatalf("set failed: %v", err)
				}
			case knowledge.StatusReady:
				// Through the lifecycle, because FinishDocument only accepts a
				// document that is actually being worked on.
				if err := store.SetDocumentStatus(ctx, user, doc.ID, knowledge.StatusParsing, ""); err != nil {
					t.Fatalf("set parsing: %v", err)
				}
				if err := store.FinishDocument(ctx, user, doc.ID, 3,
					knowledge.ProcessedBy{Parser: "gemini"}, "/data/parsed/x-v1.md"); err != nil {
					t.Fatalf("FinishDocument: %v", err)
				}
			}

			// The zombie writes, late.
			for _, working := range []string{knowledge.StatusParsing, knowledge.StatusIndexing, knowledge.StatusQueued} {
				_ = store.SetDocumentStatus(ctx, user, doc.ID, working, "")
				got, err := store.GetDocument(ctx, user, doc.ID)
				if err != nil {
					t.Fatalf("GetDocument: %v", err)
				}
				if got.Status != terminal {
					t.Fatalf("a late %q write moved a %q document to %q — it is now stuck with nothing running",
						working, terminal, got.Status)
				}
			}
		})
	}
}

// The other direction of the same window, and the one missed on the first
// attempt at this guard: a straggler must not be able to publish a document
// somebody else already failed, nor re-fail one somebody else made ready.
//
// A late `ready` is the worse of the two. It would overwrite page_count,
// parsed_markdown_path and processed_by with the straggler's, while the rows in
// `chunks` belong to whichever worker actually won — a document advertising a
// parse that does not match its own passages.
func TestAStragglerCannotPublishOrUnpublishASettledDocument(t *testing.T) {
	pool := testutil.TestDB(t)
	store := pg.NewKnowledgeStore(pool)
	ctx := context.Background()

	user := makeUser(t, pool, "straggler")
	kb, err := store.CreateKB(ctx, user, "Straggler KB")
	if err != nil {
		t.Fatalf("CreateKB: %v", err)
	}

	t.Run("cannot finish a failed document", func(t *testing.T) {
		doc := seedDocument(t, store, user, kb.ID, "failed-then-finished.pdf")
		if err := store.SetDocumentStatus(ctx, user, doc.ID, knowledge.StatusFailed,
			"every configured model failed"); err != nil {
			t.Fatalf("set failed: %v", err)
		}

		err := store.FinishDocument(ctx, user, doc.ID, 99,
			knowledge.ProcessedBy{Parser: "zombie"}, "/data/parsed/zombie-v1.md")
		if !errors.Is(err, knowledge.ErrDocumentFinal) {
			t.Fatalf("err = %v, want ErrDocumentFinal", err)
		}

		got, _ := store.GetDocument(ctx, user, doc.ID)
		if got.Status != knowledge.StatusFailed {
			t.Fatalf("a straggler published a failed document: %q", got.Status)
		}
		if got.PageCount == 99 || got.ParsedMarkdownPath != "" {
			t.Fatalf("the straggler's parse metadata was written anyway: %+v", got)
		}
	})

	t.Run("cannot fail a ready document", func(t *testing.T) {
		doc := seedDocument(t, store, user, kb.ID, "ready-then-failed.pdf")
		if err := store.SetDocumentStatus(ctx, user, doc.ID, knowledge.StatusIndexing, ""); err != nil {
			t.Fatalf("set indexing: %v", err)
		}
		if err := store.FinishDocument(ctx, user, doc.ID, 12,
			knowledge.ProcessedBy{Parser: "gemini"}, "/data/parsed/real-v1.md"); err != nil {
			t.Fatalf("FinishDocument: %v", err)
		}

		err := store.SetDocumentStatus(ctx, user, doc.ID, knowledge.StatusFailed, "zombie says so")
		if !errors.Is(err, knowledge.ErrDocumentFinal) {
			t.Fatalf("err = %v, want ErrDocumentFinal", err)
		}

		got, _ := store.GetDocument(ctx, user, doc.ID)
		if got.Status != knowledge.StatusReady {
			t.Fatalf("a straggler un-published an indexed document: %q", got.Status)
		}
		if got.PageCount != 12 {
			t.Fatalf("page count was clobbered: %d", got.PageCount)
		}
	})

	t.Run("cannot requeue a settled document", func(t *testing.T) {
		doc := seedDocument(t, store, user, kb.ID, "settled-then-requeued.pdf")
		if err := store.SetDocumentStatus(ctx, user, doc.ID, knowledge.StatusFailed,
			"unsupported file type"); err != nil {
			t.Fatalf("set failed: %v", err)
		}
		if err := store.RequeueDocument(ctx, user, doc.ID, "retrying"); !errors.Is(err, knowledge.ErrDocumentFinal) {
			t.Fatalf("err = %v, want ErrDocumentFinal", err)
		}
		got, _ := store.GetDocument(ctx, user, doc.ID)
		if got.Error != "unsupported file type" {
			t.Fatalf("the settled reason was overwritten: %q", got.Error)
		}
	})
}

// A retryable failure keeps the document movable, and keeps its reason.
func TestRequeueDocumentCarriesTheReasonAndStaysMovable(t *testing.T) {
	pool := testutil.TestDB(t)
	store := pg.NewKnowledgeStore(pool)
	ctx := context.Background()

	user := makeUser(t, pool, "requeue")
	kb, _ := store.CreateKB(ctx, user, "Requeue KB")
	doc := seedDocument(t, store, user, kb.ID, "retry.pdf")

	if err := store.SetDocumentStatus(ctx, user, doc.ID, knowledge.StatusParsing, ""); err != nil {
		t.Fatalf("set parsing: %v", err)
	}
	if err := store.RequeueDocument(ctx, user, doc.ID, "the embedding model could not be reached"); err != nil {
		t.Fatalf("RequeueDocument: %v", err)
	}

	got, _ := store.GetDocument(ctx, user, doc.ID)
	if got.Status != knowledge.StatusQueued {
		t.Fatalf("status = %q, want queued", got.Status)
	}
	// The reason is current, not stale: the document really is waiting to be
	// retried and the user is owed the reason the last attempt did not work.
	if got.Error != "the embedding model could not be reached" {
		t.Fatalf("the retry reason was dropped: %q", got.Error)
	}
	// And the next attempt can still move it, which is the whole point.
	if err := store.SetDocumentStatus(ctx, user, doc.ID, knowledge.StatusParsing, ""); err != nil {
		t.Fatalf("the next attempt could not start: %v", err)
	}
}

// The guard must not block the transitions that ARE legitimate.
func TestTheForwardLifecycleIsStillAllowed(t *testing.T) {
	pool := testutil.TestDB(t)
	store := pg.NewKnowledgeStore(pool)
	ctx := context.Background()

	user := makeUser(t, pool, "forward")
	kb, _ := store.CreateKB(ctx, user, "Forward KB")
	doc := seedDocument(t, store, user, kb.ID, "forward.pdf")

	for _, s := range []string{knowledge.StatusParsing, knowledge.StatusIndexing, knowledge.StatusFailed} {
		if err := store.SetDocumentStatus(ctx, user, doc.ID, s, "reason"); err != nil {
			t.Fatalf("SetDocumentStatus(%s): %v", s, err)
		}
		got, _ := store.GetDocument(ctx, user, doc.ID)
		if got.Status != s {
			t.Fatalf("status = %q, want %q", got.Status, s)
		}
	}

	// A failed document can still be retried by an EXPLICIT reset, which is
	// what a re-upload or a phase-8 re-parse needs. Explicit on purpose: an
	// unconditional write is what let the zombie above corrupt the row.
	if err := store.ResetDocumentForReprocessing(ctx, user, doc.ID); err != nil {
		t.Fatalf("ResetDocumentForReprocessing: %v", err)
	}
	got, _ := store.GetDocument(ctx, user, doc.ID)
	if got.Status != knowledge.StatusQueued || got.Error != "" {
		t.Fatalf("after an explicit reset: status=%q error=%q", got.Status, got.Error)
	}
}

// The same file twice in one knowledge base is one document.
func TestDuplicateUploadIsRefusedPerKnowledgeBase(t *testing.T) {
	pool := testutil.TestDB(t)
	store := pg.NewKnowledgeStore(pool)
	ctx := context.Background()

	user := makeUser(t, pool, "dup")
	kb1, _ := store.CreateKB(ctx, user, "KB one")
	kb2, _ := store.CreateKB(ctx, user, "KB two")

	digest := strings.Repeat("c", 64)
	mk := func(kbID uuid.UUID) error {
		_, err := store.CreateDocument(ctx, knowledge.Document{
			UserID: user, KBID: kbID, SourceKind: knowledge.SourceUpload,
			Title: "same.pdf", MIME: "application/pdf", Bytes: 10,
			SHA256: digest, PageCount: 1,
		})
		return err
	}

	if err := mk(kb1.ID); err != nil {
		t.Fatalf("first upload: %v", err)
	}
	if err := mk(kb1.ID); err == nil {
		t.Fatal("the same file twice in one knowledge base must be refused")
	}
	// But the same file in a DIFFERENT knowledge base is a legitimate thing to
	// want: the same paper can belong to two subjects.
	if err := mk(kb2.ID); err != nil {
		t.Fatalf("same file in another knowledge base: %v", err)
	}
}

func TestDeletingAKBRemovesItsDocumentsAndChunks(t *testing.T) {
	pool := testutil.TestDB(t)
	store := pg.NewKnowledgeStore(pool)
	chunks := pg.NewChunkStore(pool)
	ctx := context.Background()

	user := makeUser(t, pool, "cascade")
	kb, _ := store.CreateKB(ctx, user, "Cascade KB")
	doc := seedDocument(t, store, user, kb.ID, "doc.pdf")
	seedChunk(t, chunks, user, kb.ID, doc.ID, "some text")

	if err := store.DeleteKB(ctx, user, kb.ID); err != nil {
		t.Fatalf("DeleteKB: %v", err)
	}
	if _, err := store.GetDocument(ctx, user, doc.ID); !errors.Is(err, authz.ErrNoAccess) {
		t.Fatalf("the document survived its knowledge base: %v", err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM chunks WHERE document_id = $1`, doc.ID).Scan(&n); err != nil {
		t.Fatalf("count chunks: %v", err)
	}
	if n != 0 {
		t.Fatalf("%d chunks survived their knowledge base", n)
	}
}

// Re-chunking must be atomic. Delete-then-commit-then-insert would leave a
// window where the document is `ready` and retrieves nothing.
func TestReplaceDocumentChunksIsAtomic(t *testing.T) {
	pool := testutil.TestDB(t)
	store := pg.NewKnowledgeStore(pool)
	chunks := pg.NewChunkStore(pool)
	ctx := context.Background()

	user := makeUser(t, pool, "replace")
	kb, _ := store.CreateKB(ctx, user, "Replace KB")
	doc := seedDocument(t, store, user, kb.ID, "doc.pdf")
	seedChunk(t, chunks, user, kb.ID, doc.ID, "original passage")

	vec := make([]float32, embed.StorageDims)
	vec[0] = 1
	bad := []knowledge.StoredChunk{
		{Ord: 0, PageStart: 1, PageEnd: 1, Text: "new first", Embedding: vec, Dims: 1536},
		{Ord: 1, PageStart: 1, PageEnd: 1, Text: "new second", Embedding: vec[:100], Dims: 1536}, // too short
	}
	if err := chunks.ReplaceDocumentChunks(ctx, user, kb.ID, doc.ID, bad); err == nil {
		t.Fatal("expected the short vector to be refused")
	}

	// The original chunks must still be there: a failed replace leaves the
	// document retrievable exactly as it was.
	got, err := chunks.ChunkTexts(ctx, user, doc.ID)
	if err != nil {
		t.Fatalf("ChunkTexts: %v", err)
	}
	if len(got) != 1 || got[0].Text != "original passage" {
		t.Fatalf("after a failed replace the chunks are %+v", got)
	}
}
