package account_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/account"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/connectors/feeds"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

type recorder struct {
	calls []uuid.UUID
	err   error
}

func (r *recorder) Disconnect(_ context.Context, id uuid.UUID) error {
	r.calls = append(r.calls, id)
	return r.err
}
func (r *recorder) RevokeAll(_ context.Context, id uuid.UUID) error {
	r.calls = append(r.calls, id)
	return r.err
}

// seed gives a user a key, a knowledge base, a document with both files.
func seed(t *testing.T, pool *pgxpool.Pool, files *blob.Local) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	user := testutil.NewUser(t, pool)
	if _, err := pg.NewProviderConnectionStore(pool, testutil.TestEncryptionKey).CreateConnection(ctx, user,
		store.NewProviderConnection{Provider: "openai", Kind: store.KindAPIKey, Name: "k", Secret: "sk-x"}); err != nil {
		t.Fatal(err)
	}
	digest, err := files.PutOriginal(ctx, user, []byte("pdf-"+user.String()))
	if err != nil {
		t.Fatal(err)
	}
	kbs := pg.NewKnowledgeStore(pool)
	kb, err := kbs.CreateKB(ctx, user, "KB")
	if err != nil {
		t.Fatal(err)
	}
	// up methods, phase 20: a Zotero key, and the document came from Zotero.
	if _, err := pg.NewSearchConnectionStore(pool, testutil.TestEncryptionKey).UpsertSearchConnection(ctx, user,
		"zotero", "475425:KEY0FIXTURE0000000000000"); err != nil {
		t.Fatal(err)
	}
	doc, err := kbs.CreateDocument(ctx, knowledge.Document{
		UserID: user, KBID: kb.ID, SourceKind: "upload", Title: "a.pdf",
		MIME: "application/pdf", Bytes: 4, SHA256: digest, Status: "ready", ZoteroKey: "ABCD2345",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := files.PutParsed(ctx, user, doc.ID, 1, "# p"); err != nil {
		t.Fatal(err)
	}
	seedLearningDepth(t, pool, files, user, kb.ID, doc.ID)
	seedSources(t, pool, user, kb.ID, digest)
	seedMedia(t, pool, files, user, kb.ID)
	seedFeeds(t, pool, user, kb.ID, doc.ID)
	seedDriveStorage(t, pool, files, user, digest)
	return user
}

// seedDriveStorage gives the user an original and a recording kept in their
// Google Drive, their "AnyTools" folders, and a cached copy on the server
// (drive-user-storage phase 1).
func seedDriveStorage(t *testing.T, pool *pgxpool.Pool, files *blob.Local, user uuid.UUID, digest string) {
	t.Helper()
	ctx := context.Background()
	driveFiles := pg.NewDriveFileStore(pool)
	for _, f := range []blob.DriveFile{
		{UserID: user, Kind: blob.KindOriginal, Key: digest, DriveFileID: "driveOriginal", SHA256: digest, Bytes: 4},
		{UserID: user, Kind: "recordings", Key: uuid.NewString(), DriveFileID: "driveRecording", SHA256: digest, Bytes: 4},
	} {
		if err := driveFiles.PutDriveFile(ctx, f); err != nil {
			t.Fatal(err)
		}
	}
	for _, role := range blob.FolderRoles {
		if err := driveFiles.SaveFolder(ctx, user, role, "folder_"+role); err != nil {
			t.Fatal(err)
		}
	}
	cache, err := blob.NewCache(filepath.Join(files.Root(), blob.CacheDir), 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	if err := cache.Put(user, []byte("cached "+user.String())); err != nil {
		t.Fatal(err)
	}
}

// seedFeeds gives the user a podcast feed with an entry added as a document,
// and a YouTube Data API key (up-methods phase 17).
func seedFeeds(t *testing.T, pool *pgxpool.Pool, user, kb, doc uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	store := pg.NewFeedStore(pool)
	feed, err := store.CreateFeed(ctx, knowledge.Feed{UserID: user, KBID: kb, Kind: "podcast",
		URL: "https://podcast.example.com/feed.rss", Title: "A podcast", ListedBy: knowledge.ListedByFeed},
		knowledge.FeedListing{Entries: []feeds.Entry{{Key: "0123456789abcdef0123456789abcdef", Title: "Episode 1",
			MediaURL: "https://podcast.example.com/ep1.mp3", MediaType: "audio/mpeg"}}},
		knowledge.MaxFeedsPerKB, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetEntryAdded(ctx, user, feed.ID, "0123456789abcdef0123456789abcdef", &doc); err != nil {
		t.Fatal(err)
	}
	if _, err := pg.NewSearchConnectionStore(pool, testutil.TestEncryptionKey).UpsertSearchConnection(ctx, user, "youtube_data", "AIza-x"); err != nil {
		t.Fatal(err)
	}
}

// seedMedia gives the user an uploaded recording waiting for its transcript,
// and the recording's file (up-methods phase 15).
func seedMedia(t *testing.T, pool *pgxpool.Pool, files *blob.Local, user, kb uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	audio := []byte("ID3-recording-" + user.String())
	digest, err := files.PutOriginal(ctx, user, audio)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pg.NewKnowledgeStore(pool).CreateLinkDocument(ctx, knowledge.Document{UserID: user, KBID: kb,
		SourceKind: knowledge.SourceMedia, Title: "class.mp3", MIME: "audio/mpeg", Bytes: int64(len(audio)), SHA256: digest,
		MediaSHA256: digest, MediaMIME: "audio/mpeg", MediaBytes: int64(len(audio)),
		Status: knowledge.StatusNeedsTranscript, Media: &knowledge.VideoMedia{DurationSeconds: 180}}); err != nil {
		t.Fatal(err)
	}
}

// seedSources gives the user a crawled site with a page and its frontier
// row, a repository with a file, and a GitHub token (up-methods phase 18).
func seedSources(t *testing.T, pool *pgxpool.Pool, user, kb uuid.UUID, digest string) {
	t.Helper()
	ctx := context.Background()
	sources := pg.NewSourceStore(pool)
	site, err := sources.CreateSite(ctx, knowledge.Site{UserID: user, KBID: kb,
		StartURL: "https://docs.example.com/", PathPrefix: "/", MaxDepth: 1, MaxPages: 5})
	if err != nil {
		t.Fatal(err)
	}
	repo, err := sources.CreateRepo(ctx, knowledge.Repo{UserID: user, KBID: kb, Owner: "acme", Name: "docs",
		Extensions: []string{".md"}, IgnorePaths: []string{}})
	if err != nil {
		t.Fatal(err)
	}
	kbs := pg.NewKnowledgeStore(pool)
	page, err := kbs.CreateLinkDocument(ctx, knowledge.Document{UserID: user, KBID: kb, SourceKind: knowledge.SourceSitePage,
		SourceURL: "https://docs.example.com/", SiteID: &site.ID, Title: "Docs", MIME: "text/html", Bytes: 4, SHA256: digest})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := kbs.CreateLinkDocument(ctx, knowledge.Document{UserID: user, KBID: kb, SourceKind: knowledge.SourceRepoFile,
		SourceURL: "https://github.com/acme/docs/blob/main/README.md", SourcePath: "README.md", RepoID: &repo.ID,
		Title: "README.md", MIME: "text/markdown", Bytes: 4, SHA256: digest}); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO site_pages (site_id, user_id, url, depth, crawl_ord, status, document_id)
		VALUES ($1, $2, 'https://docs.example.com/', 0, 0, 'added', $3)`, site.ID, user, page.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pg.NewSearchConnectionStore(pool, testutil.TestEncryptionKey).UpsertSearchConnection(ctx, user, "github", "github_pat_x"); err != nil {
		t.Fatal(err)
	}
}

// seedLearningDepth gives the user a row in the learning-depth tables that
// hang off a knowledge base or a document, plus per-row files (an exam paper,
// an audio overview), so deletion is shown to take them too.
func seedLearningDepth(t *testing.T, pool *pgxpool.Pool, files *blob.Local, user, kb, doc uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	var q uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO questions (user_id, kb_id, prompt, type, answer)
		VALUES ($1, $2, 'p', 'short', 'a') RETURNING id`, user, kb).Scan(&q); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO error_records (user_id, question_id) VALUES ($1, $2)`, user, q)
	exec(`INSERT INTO audio_overviews (user_id, kb_id, language, minutes) VALUES ($1, $2, 'en', 5)`, user, kb)
	exec(`INSERT INTO related_paper_cache (user_id, kb_id, focus, payload) VALUES ($1, $2, '', '{}')`, user, kb)
	exec(`INSERT INTO paper_search_usage (user_id, day, count) VALUES ($1, current_date, 1)`, user)
	// Up-methods phase 21: built-in transcription minutes. A fixed date: the
	// learner's day is computed in Go, and any day serves this seed.
	exec(`INSERT INTO stt_usage (user_id, day, seconds) VALUES ($1, '2026-10-16', 60)`, user)
	exec(`INSERT INTO tts_usage (user_id, day, seconds) VALUES ($1, '2026-10-16', 60)`, user)
	exec(`INSERT INTO vocab_notes (user_id, term, lang, meaning, source_document_id) VALUES ($1, 'báo', 'vi', 'newspaper', $2)`, user, doc)
	// up methods, phase 0: a worksheet on the document, and one on nothing.
	exec(`INSERT INTO worksheets (user_id, kind, kind_version, title, private, document_id) VALUES ($1, 'example', 1, 't', false, $2)`, user, doc)
	exec(`INSERT INTO worksheets (user_id, kind, kind_version, title, private) VALUES ($1, 'example', 1, 'p', true)`, user)
	// up methods, phase 7: a recording on a speaking worksheet, and its file.
	var sheet, recording uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO worksheets (user_id, kind, kind_version, title, private)
		VALUES ($1, 'speaking_evidence', 1, 's', false) RETURNING id`, user).Scan(&sheet); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO worksheet_recordings (user_id, worksheet_id, mime, bytes, duration_seconds)
		VALUES ($1, $2, 'audio/webm', 1, 90) RETURNING id`, user, sheet).Scan(&recording); err != nil {
		t.Fatal(err)
	}
	if err := files.PutObject(ctx, user, "recordings", recording, []byte("x")); err != nil {
		t.Fatal(err)
	}
	// up methods, phase 4: a writing diagnosis of the worksheet on the document.
	exec(`INSERT INTO worksheet_diagnoses (user_id, worksheet_id, pass, draft_sha256, issues)
		SELECT user_id, id, 1, repeat('a', 64), '[]' FROM worksheets WHERE user_id = $1 AND title = 't'`, user)
	// up methods, phase 14: the attachment types the seed above lacks, a
	// worksheet on a learning state and a cycle close on its cycle (phase 10),
	// and a production card (phase 3).
	var state, cycle uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO learning_states (user_id, goal) VALUES ($1, 'g') RETURNING id`, user).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO cycles (user_id, state_id) VALUES ($1, $2) RETURNING id`, user, state).Scan(&cycle); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO worksheets (user_id, kind, kind_version, title, private, state_id)
		VALUES ($1, 'writing_evidence', 1, 'w', false, $2)`, user, state)
	exec(`INSERT INTO worksheets (user_id, kind, kind_version, title, private, state_id, cycle_id)
		VALUES ($1, 'cycle_close', 1, 'c', false, $2, $3)`, user, state, cycle)
	var word uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO vocab_notes (user_id, term, lang, meaning, production, scenario)
		VALUES ($1, 'tin', 'vi', 'news', true, 'At the kiosk') RETURNING id`, user).Scan(&word); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO vocab_cards (user_id, note_id, kind, due_at) VALUES ($1, $2, 'production', now())`, user, word)
	for _, ns := range []string{"exam_papers", "audio"} {
		if err := files.PutObject(ctx, user, ns, uuid.New(), []byte("x")); err != nil {
			t.Fatal(err)
		}
	}
}

// rowsOwnedBy counts, across EVERY table with a user_id column, the rows the
// user owns. Discovered from the catalog, so a table added later is covered.
func rowsOwnedBy(t *testing.T, pool *pgxpool.Pool, user uuid.UUID) map[string]int {
	t.Helper()
	ctx := context.Background()
	rows, err := pool.Query(ctx, `
		SELECT table_name FROM information_schema.columns
		 WHERE table_schema = 'public' AND column_name = 'user_id'`)
	if err != nil {
		t.Fatal(err)
	}
	var tables []string
	for rows.Next() {
		var n string
		_ = rows.Scan(&n)
		tables = append(tables, n)
	}
	rows.Close()
	out := map[string]int{}
	for _, table := range tables {
		var n int
		if err := pool.QueryRow(ctx, fmt.Sprintf(`SELECT count(*) FROM %q WHERE user_id = $1`, table), user).Scan(&n); err != nil {
			t.Fatalf("%s: %v", table, err)
		}
		if n > 0 {
			out[table] = n
		}
	}
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE id = $1`, user).Scan(&n)
	if n > 0 {
		out["users"] = n
	}
	return out
}

func TestDeleteRemovesEverythingTheUserOwnsAndNothingElse(t *testing.T) {
	pool := testutil.TestDB(t)
	files, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	alice, bob := seed(t, pool, files), seed(t, pool, files)
	// A provider outage during revocation must not keep the data.
	drive, tokens := &recorder{err: errors.New("google is down")}, &recorder{}

	if got := rowsOwnedBy(t, pool, alice); len(got) < 4 {
		t.Fatalf("the fixture owns too little to prove anything: %v", got)
	}
	// up methods (phase 14): a worksheet of each attachment type — none,
	// document, learning state, cycle — a recording and a production card.
	var attachments, recordings, production int
	_ = pool.QueryRow(context.Background(), `SELECT
		(SELECT count(DISTINCT (document_id IS NOT NULL, state_id IS NOT NULL, cycle_id IS NOT NULL)) FROM worksheets WHERE user_id = $1),
		(SELECT count(*) FROM worksheet_recordings WHERE user_id = $1),
		(SELECT count(*) FROM vocab_cards WHERE user_id = $1 AND kind = 'production')`, alice).Scan(&attachments, &recordings, &production)
	if attachments != 4 || recordings == 0 || production == 0 {
		t.Fatalf("the fixture lacks a worksheet attachment type (%d of 4), a recording (%d) or a production card (%d)",
			attachments, recordings, production)
	}

	// Each one's knowledge base has its own vector index, which a cascade
	// cannot drop.
	kbOf := func(user uuid.UUID) uuid.UUID {
		var id uuid.UUID
		if err := pool.QueryRow(context.Background(), `SELECT id FROM knowledge_bases WHERE user_id = $1 LIMIT 1`, user).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	aliceKB, bobKB := kbOf(alice), kbOf(bob)

	if err := account.New(pool, files, drive, tokens).Delete(context.Background(), alice); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if has, _ := pg.HasKBVectorIndex(context.Background(), pool, aliceKB); has {
		t.Error("alice's vector index outlived her knowledge base")
	}
	if has, _ := pg.HasKBVectorIndex(context.Background(), pool, bobKB); !has {
		t.Error("bob's vector index was dropped")
	}

	if got := rowsOwnedBy(t, pool, alice); len(got) != 0 {
		t.Errorf("rows left behind: %v", got)
	}
	if got := rowsOwnedBy(t, pool, bob); len(got) < 4 {
		t.Errorf("bob's data was touched: %v", got)
	}
	if len(drive.calls) != 1 || drive.calls[0] != alice || len(tokens.calls) != 1 {
		t.Errorf("grants not revoked at the providers: drive=%v tokens=%v", drive.calls, tokens.calls)
	}

	ctx := context.Background()
	var bobDigest string
	_ = pool.QueryRow(ctx, `SELECT sha256 FROM documents WHERE user_id = $1 AND source_kind = 'upload'`, bob).Scan(&bobDigest)
	var bobRecording string
	_ = pool.QueryRow(ctx, `SELECT media_sha256 FROM documents WHERE user_id = $1 AND source_kind = 'media'`, bob).Scan(&bobRecording)
	if _, err := files.GetOriginal(ctx, bob, bobRecording); err != nil {
		t.Errorf("bob's recording was deleted: %v", err)
	}
	if _, err := files.GetOriginal(ctx, bob, bobDigest); err != nil {
		t.Errorf("bob's file was deleted: %v", err)
	}
	for _, kind := range []string{"originals", "parsed", "objects", blob.CacheDir} {
		if _, err := os.Stat(filepath.Join(files.Root(), kind, alice.String())); !os.IsNotExist(err) {
			t.Errorf("alice's %s directory is still there (%v)", kind, err)
		}
	}
	if _, err := os.Stat(filepath.Join(files.Root(), blob.CacheDir, bob.String())); err != nil {
		t.Errorf("bob's cache went with alice's account: %v", err)
	}
	if err := files.DeleteUser(ctx, alice); err != nil {
		t.Errorf("DeleteUser is not idempotent: %v", err)
	}

	if err := account.New(pool, files, nil, nil).Delete(ctx, alice); !errors.Is(err, account.ErrNotFound) {
		t.Errorf("second delete: %v, want ErrNotFound", err)
	}
}

// Deletion relies on ON DELETE CASCADE from every table to users. A foreign
// key without it would make DELETE FROM users fail — or, if it were SET NULL,
// silently keep the data.
func TestEveryForeignKeyToUsersCascades(t *testing.T) {
	pool := testutil.TestDB(t)
	rows, err := pool.Query(context.Background(), `
		SELECT conrelid::regclass::text, conname
		  FROM pg_constraint
		 WHERE contype = 'f' AND confrelid = 'users'::regclass AND confdeltype <> 'c'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var table, name string
		_ = rows.Scan(&table, &name)
		t.Errorf("%s.%s references users without ON DELETE CASCADE", table, name)
	}
}

// TestEveryUserOwnedTableReferencesUsers is the other half of the cascade
// check: a table with a user_id column and no foreign key to users at all
// would pass it, and outlive the account. drive_files and drive_folders are
// named so they can never drop out of the catalog query unnoticed
// (drive-user-storage phase 4).
func TestEveryUserOwnedTableReferencesUsers(t *testing.T) {
	pool := testutil.TestDB(t)
	rows, err := pool.Query(context.Background(), `
		SELECT c.table_name,
		       EXISTS (SELECT 1 FROM pg_constraint k
		                WHERE k.contype = 'f' AND k.conrelid = c.table_name::regclass
		                  AND k.confrelid = 'users'::regclass AND k.confdeltype = 'c')
		  FROM information_schema.columns c
		  JOIN information_schema.tables t
		    ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
		 WHERE c.table_schema = 'public' AND c.column_name = 'user_id'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	seen := map[string]bool{}
	for rows.Next() {
		var table string
		var cascades bool
		if err := rows.Scan(&table, &cascades); err != nil {
			t.Fatal(err)
		}
		seen[table] = true
		if !cascades {
			t.Errorf("%s has a user_id but no foreign key to users with ON DELETE CASCADE", table)
		}
	}
	for _, table := range []string{"drive_files", "drive_folders", "drive_connections"} {
		if !seen[table] {
			t.Errorf("%s is not a user-owned table any more", table)
		}
	}
}
