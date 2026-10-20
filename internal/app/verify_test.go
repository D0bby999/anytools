package app

import (
	"context"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// restoredFixture is a database and data directory as a good restore leaves
// them: a booted sentinel, one encrypted API key, one uploaded and parsed
// document with both files on disk.
func restoredFixture(t *testing.T) (pool *pg.Pool, dataDir string) {
	t.Helper()
	ctx := context.Background()
	pool = freshDatabase(t)
	key := testutil.TestEncryptionKey

	if err := pg.NewSentinelStore(pool, key).Verify(ctx); err != nil {
		t.Fatalf("seed sentinel: %v", err)
	}

	user := testutil.NewUser(t, pool)
	if _, err := pg.NewProviderConnectionStore(pool, key).CreateConnection(ctx, user, store.NewProviderConnection{
		Provider: "openai", Kind: store.KindAPIKey, Name: "k", Secret: "sk-test-secret",
	}); err != nil {
		t.Fatalf("create connection: %v", err)
	}

	dataDir = t.TempDir()
	blobs, err := blob.NewLocal(dataDir)
	if err != nil {
		t.Fatalf("blob store: %v", err)
	}
	digest, err := blobs.PutOriginal(ctx, user, []byte("%PDF-1.4 fixture"))
	if err != nil {
		t.Fatalf("put original: %v", err)
	}
	kbs := pg.NewKnowledgeStore(pool)
	kb, err := kbs.CreateKB(ctx, user, "Restored")
	if err != nil {
		t.Fatalf("create kb: %v", err)
	}
	doc, err := kbs.CreateDocument(ctx, knowledge.Document{
		UserID: user, KBID: kb.ID, SourceKind: "upload", Title: "fixture.pdf",
		MIME: "application/pdf", Bytes: 16, SHA256: digest, Status: "ready",
	})
	if err != nil {
		t.Fatalf("create document: %v", err)
	}
	parsed, err := blobs.PutParsed(ctx, user, doc.ID, 1, "# Page 1")
	if err != nil {
		t.Fatalf("put parsed: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE documents SET parsed_markdown_path = $1 WHERE id = $2`, parsed, doc.ID); err != nil {
		t.Fatalf("record parsed path: %v", err)
	}
	return pool, dataDir
}

func TestVerifyPassesAGoodRestore(t *testing.T) {
	pool, dataDir := restoredFixture(t)
	report, err := Verify(context.Background(), pool, testutil.TestEncryptionKey, dataDir, config.R2Config{})
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if !report.OK() || report.SecretsChecked != 1 || report.DocumentsChecked != 1 {
		t.Fatalf("report = %+v", report)
	}
}

func TestVerifyCatchesEachWayARestoreGoesWrong(t *testing.T) {
	cases := []struct {
		name   string
		break_ func(t *testing.T, pool *pg.Pool, dataDir string) (key, dir string)
		want   string
	}{
		{"the wrong key", func(t *testing.T, _ *pg.Pool, dir string) (string, string) {
			return "a-different-key-of-sufficient-length-000000", dir
		}, "does not decrypt"},
		{"the data directory was not restored", func(t *testing.T, _ *pg.Pool, _ string) (string, string) {
			return testutil.TestEncryptionKey, t.TempDir()
		}, "original file missing"},
		{"parsed Markdown lost", func(t *testing.T, pool *pg.Pool, dir string) (string, string) {
			var parsed string
			if err := pool.QueryRow(context.Background(), `SELECT parsed_markdown_path FROM documents`).Scan(&parsed); err != nil {
				t.Fatal(err)
			}
			target := parsed
			if !filepath.IsAbs(target) {
				target = filepath.Join(dir, parsed)
			}
			if err := os.Remove(target); err != nil {
				t.Fatalf("remove parsed: %v", err)
			}
			return testutil.TestEncryptionKey, dir
		}, "parsed Markdown missing"},
		{"a secret stored in the clear", func(t *testing.T, pool *pg.Pool, dir string) (string, string) {
			if _, err := pool.Exec(context.Background(), `UPDATE provider_connections SET secret_enc = 'sk-plaintext'`); err != nil {
				t.Fatal(err)
			}
			return testutil.TestEncryptionKey, dir
		}, "not encrypted"},
		{"the sentinel was not restored", func(t *testing.T, pool *pg.Pool, dir string) (string, string) {
			if _, err := pool.Exec(context.Background(), `DELETE FROM app_sentinel`); err != nil {
				t.Fatal(err)
			}
			return testutil.TestEncryptionKey, dir
		}, "app_sentinel is empty"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pool, dataDir := restoredFixture(t)
			key, dir := tc.break_(t, pool, dataDir)
			report, err := Verify(context.Background(), pool, key, dir, config.R2Config{})
			if err != nil {
				t.Fatalf("Verify: %v", err)
			}
			if report.OK() || !strings.Contains(strings.Join(report.Problems, "\n"), tc.want) {
				t.Fatalf("problems = %v, want one containing %q", report.Problems, tc.want)
			}
			// Read-only: a missing sentinel must not have been seeded.
			var n int
			_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM app_sentinel`).Scan(&n)
			if tc.want == "app_sentinel is empty" && n != 0 {
				t.Fatal("Verify seeded the sentinel it was checking")
			}
		})
	}
}

// Drive-user-storage phase 1: an original kept in the learner's Google Drive
// is not on this disk, and that is not a problem; one the learner removed
// from their Drive is. A row is matched by its owner, not by digest alone.
func TestVerifyKnowsWhereEachLearnersOriginalsAre(t *testing.T) {
	ctx := context.Background()
	pool, dataDir := restoredFixture(t)
	var (
		owner  uuid.UUID
		digest string
	)
	if err := pool.QueryRow(ctx, `SELECT user_id, sha256 FROM documents`).Scan(&owner, &digest); err != nil {
		t.Fatal(err)
	}
	local, _ := blob.NewLocal(dataDir)
	if err := local.DeleteOriginal(ctx, owner, digest); err != nil {
		t.Fatal(err)
	}
	files := pg.NewDriveFileStore(pool)
	row := blob.DriveFile{Kind: blob.KindOriginal, Key: digest, DriveFileID: "inDrive", SHA256: digest, Bytes: 16}

	// Another learner's row for the same bytes says nothing about this one.
	row.UserID = testutil.NewUser(t, pool)
	if err := files.PutDriveFile(ctx, row); err != nil {
		t.Fatal(err)
	}
	report, err := Verify(ctx, pool, testutil.TestEncryptionKey, dataDir, config.R2Config{})
	if err != nil {
		t.Fatal(err)
	}
	if report.OK() || report.InDrive != 0 {
		t.Fatalf("another learner's row hid a missing original: %+v", report)
	}

	row.UserID = owner
	if err := files.PutDriveFile(ctx, row); err != nil {
		t.Fatal(err)
	}
	report, err = Verify(ctx, pool, testutil.TestEncryptionKey, dataDir, config.R2Config{})
	if err != nil {
		t.Fatal(err)
	}
	if !report.OK() || report.InDrive != 1 {
		t.Fatalf("an original in Drive: %+v", report)
	}

	if err := files.MarkDriveFileMissing(ctx, owner, blob.KindOriginal, digest); err != nil {
		t.Fatal(err)
	}
	report, err = Verify(ctx, pool, testutil.TestEncryptionKey, dataDir, config.R2Config{})
	if err != nil {
		t.Fatal(err)
	}
	if report.OK() || !strings.Contains(strings.Join(report.Problems, "\n"), "removed the original from their Google Drive") {
		t.Fatalf("a removed original: %+v", report)
	}
}

// freshDatabase creates a migrated database of its own, as a restore target
// is. Verify reads EVERY row, so it cannot share the package's test database:
// other packages' tests run concurrently against that one, and resetting its
// sentinel or documents under them would break them.
func freshDatabase(t *testing.T) *pg.Pool {
	t.Helper()
	ctx := context.Background()
	admin := testutil.TestDB(t)

	name := "lp_verify_" + strings.ReplaceAll(uuid.NewString()[:8], "-", "")
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Skipf("cannot create a scratch database (%v)", err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
	})

	u, err := url.Parse(testutil.TestDSN())
	if err != nil {
		t.Fatalf("parse DSN: %v", err)
	}
	u.Path = "/" + name
	dsn := u.String()

	m, err := migrate.New("file://../../migrations", dsn)
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := m.Up(); err != nil {
		t.Fatalf("migrate up: %v", err)
	}
	_, _ = m.Close()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open %s: %v", name, err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping %s: %v", name, err)
	}
	return pool
}
