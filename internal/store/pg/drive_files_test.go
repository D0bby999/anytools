package pg_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// Drive-user-storage phase 1: a drive_files row is read, changed and deleted
// only by its owner. Two learners who upload the same bytes share a digest
// and nothing else.
func TestAnotherLearnersDriveFileIsNeverRead(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	files := pg.NewDriveFileStore(pool)
	alice, bob := testutil.NewUser(t, pool), testutil.NewUser(t, pool)
	digest := blob.Digest([]byte("the same upload"))

	if err := files.PutDriveFile(ctx, blob.DriveFile{UserID: alice, Kind: blob.KindOriginal, Key: digest,
		DriveFileID: "aliceFile_1", SHA256: digest, Bytes: 15, MIME: "application/pdf"}); err != nil {
		t.Fatal(err)
	}
	if _, err := files.GetDriveFile(ctx, bob, blob.KindOriginal, digest); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("bob read alice's row: %v", err)
	}
	if err := files.MarkDriveFileMissing(ctx, bob, blob.KindOriginal, digest); err != nil {
		t.Fatal(err)
	}
	if err := files.DeleteDriveFile(ctx, bob, blob.KindOriginal, digest); err != nil {
		t.Fatal(err)
	}
	if err := files.PutDriveFile(ctx, blob.DriveFile{UserID: bob, Kind: blob.KindOriginal, Key: digest,
		DriveFileID: "bobFile_1", SHA256: digest, Bytes: 15}); err != nil {
		t.Fatal(err)
	}

	row, err := files.GetDriveFile(ctx, alice, blob.KindOriginal, digest)
	if err != nil {
		t.Fatal(err)
	}
	if row.DriveFileID != "aliceFile_1" || row.MissingAt != nil || row.Bytes != 15 || row.MIME != "application/pdf" {
		t.Fatalf("bob's calls changed alice's row: %+v", row)
	}
	if row, _ := files.GetDriveFile(ctx, bob, blob.KindOriginal, digest); row.DriveFileID != "bobFile_1" {
		t.Fatalf("bob's row: %+v", row)
	}
}

func TestADriveFileWrittenAgainIsNoLongerMissing(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	files := pg.NewDriveFileStore(pool)
	user, id := testutil.NewUser(t, pool), uuid.NewString()
	sha := blob.Digest([]byte("wav"))
	put := func(fileID string) {
		t.Helper()
		if err := files.PutDriveFile(ctx, blob.DriveFile{UserID: user, Kind: "audio", Key: id,
			DriveFileID: fileID, SHA256: sha, Bytes: 3}); err != nil {
			t.Fatal(err)
		}
	}
	put("first")
	if err := files.MarkDriveFileMissing(ctx, user, "audio", id); err != nil {
		t.Fatal(err)
	}
	if row, _ := files.GetDriveFile(ctx, user, "audio", id); row.MissingAt == nil {
		t.Fatal("not marked missing")
	}
	put("second")
	row, _ := files.GetDriveFile(ctx, user, "audio", id)
	if row.MissingAt != nil || row.DriveFileID != "second" {
		t.Fatalf("after a rewrite: %+v", row)
	}
	if err := files.DeleteDriveFile(ctx, user, "audio", id); err != nil {
		t.Fatal(err)
	}
	if _, err := files.GetDriveFile(ctx, user, "audio", id); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("after delete: %v", err)
	}
}

func TestDriveFileRowsRefuseMalformedKeys(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	files := pg.NewDriveFileStore(pool)
	user := testutil.NewUser(t, pool)
	sha := blob.Digest([]byte("x"))
	for name, f := range map[string]blob.DriveFile{
		"an original keyed by a uuid": {Kind: blob.KindOriginal, Key: uuid.NewString(), DriveFileID: "f", SHA256: sha},
		"an object keyed by a digest": {Kind: "audio", Key: sha, DriveFileID: "f", SHA256: sha},
		"a Drive id with a slash":     {Kind: "audio", Key: uuid.NewString(), DriveFileID: "a/../b", SHA256: sha},
		"a kind that names a path":    {Kind: "../x", Key: uuid.NewString(), DriveFileID: "f", SHA256: sha},
		"a digest that is not a hash": {Kind: "audio", Key: uuid.NewString(), DriveFileID: "f", SHA256: "nope"},
	} {
		f.UserID = user
		if err := files.PutDriveFile(ctx, f); err == nil {
			t.Errorf("%s was stored", name)
		}
	}
}

func TestDriveFoldersBelongToOneLearner(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	files := pg.NewDriveFileStore(pool)
	alice, bob := testutil.NewUser(t, pool), testutil.NewUser(t, pool)
	if err := files.SaveFolder(ctx, alice, blob.FolderRoot, "rootA"); err != nil {
		t.Fatal(err)
	}
	if err := files.SaveFolder(ctx, alice, blob.FolderRoot, "rootA2"); err != nil {
		t.Fatal(err)
	}
	if got, _ := files.ListFolders(ctx, alice); len(got) != 1 || got[blob.FolderRoot] != "rootA2" {
		t.Fatalf("alice's folders: %v", got)
	}
	if got, _ := files.ListFolders(ctx, bob); len(got) != 0 {
		t.Fatalf("bob sees %v", got)
	}
	if err := files.SaveFolder(ctx, alice, "desktop", "x"); err == nil {
		t.Fatal("an unknown folder role was stored")
	}
}

func TestDriveFileTitlesComeFromTheOwnersRows(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	files := pg.NewDriveFileStore(pool)
	alice, bob := testutil.NewUser(t, pool), testutil.NewUser(t, pool)
	kbs := pg.NewKnowledgeStore(pool)
	kb, err := kbs.CreateKB(ctx, alice, "KB")
	if err != nil {
		t.Fatal(err)
	}
	digest := blob.Digest([]byte("pdf"))
	if _, err := kbs.CreateDocument(ctx, knowledge.Document{UserID: alice, KBID: kb.ID, SourceKind: "upload",
		Title: "Organic chemistry", MIME: "application/pdf", Bytes: 3, SHA256: digest, Status: "ready"}); err != nil {
		t.Fatal(err)
	}
	if title, mime := files.Title(ctx, alice, blob.KindOriginal, digest); title != "Organic chemistry" || mime != "application/pdf" {
		t.Fatalf("alice's title: %q %q", title, mime)
	}
	if title, _ := files.Title(ctx, bob, blob.KindOriginal, digest); title != "" {
		t.Fatalf("bob's file was named after alice's document: %q", title)
	}
	if title, _ := files.Title(ctx, alice, "transcripts", uuid.NewString()); title != "" {
		t.Fatalf("a derived kind got a title: %q", title)
	}
}
