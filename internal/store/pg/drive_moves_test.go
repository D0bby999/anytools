package pg_test

import (
	"context"
	"errors"
	"testing"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// Drive-user-storage phase 2: what a move reads and writes in drive_files
// and jobs is the learner's own, and a second move cannot start while one
// runs.
func TestAMoveSeesOnlyTheLearnersOwnRows(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	files := pg.NewDriveFileStore(pool)
	alice, bob := testutil.NewUser(t, pool), testutil.NewUser(t, pool)
	digest := blob.Digest([]byte("the same upload"))
	row := blob.DriveFile{UserID: alice, Kind: blob.KindOriginal, Key: digest, DriveFileID: "aliceFile_1", SHA256: digest, Bytes: 15}
	if ok, err := files.InsertDriveFile(ctx, row); err != nil || !ok {
		t.Fatalf("insert = %v, %v", ok, err)
	}
	// A second insert for the same file changes nothing.
	again := row
	again.DriveFileID = "aliceFile_2"
	if ok, err := files.InsertDriveFile(ctx, again); err != nil || ok {
		t.Fatalf("second insert = %v, %v", ok, err)
	}

	if list, err := files.ListDriveFiles(ctx, bob); err != nil || len(list) != 0 {
		t.Fatalf("bob lists %+v, %v", list, err)
	}
	if u, err := files.DriveUsage(ctx, bob); err != nil || u.Files != 0 || u.Bytes != 0 {
		t.Fatalf("bob's usage = %+v, %v", u, err)
	}
	if ok, err := files.DeleteDriveFileIf(ctx, bob, blob.KindOriginal, digest, "aliceFile_1"); err != nil || ok {
		t.Fatalf("bob deleted alice's row: %v, %v", ok, err)
	}
	// Bob's own row for the same bytes is his and does not touch hers.
	if ok, err := files.InsertDriveFile(ctx, blob.DriveFile{UserID: bob, Kind: blob.KindOriginal, Key: digest,
		DriveFileID: "bobFile_1", SHA256: digest, Bytes: 15}); err != nil || !ok {
		t.Fatalf("bob's insert = %v, %v", ok, err)
	}
	if ok, err := files.DeleteDriveFileIf(ctx, alice, blob.KindOriginal, digest, "aliceFile_2"); err != nil || ok {
		t.Fatal("a row was deleted although it names another file")
	}

	list, err := files.ListDriveFiles(ctx, alice)
	if err != nil || len(list) != 1 || list[0].DriveFileID != "aliceFile_1" {
		t.Fatalf("alice lists %+v, %v", list, err)
	}
	if err := files.MarkDriveFileMissing(ctx, alice, blob.KindOriginal, digest); err != nil {
		t.Fatal(err)
	}
	if u, err := files.DriveUsage(ctx, alice); err != nil || u.Files != 0 || u.Missing != 1 || u.Bytes != 0 {
		t.Fatalf("alice's usage with the file removed = %+v, %v", u, err)
	}
	if ok, err := files.DeleteDriveFileIf(ctx, alice, blob.KindOriginal, digest, "aliceFile_1"); err != nil || !ok {
		t.Fatalf("alice's delete = %v, %v", ok, err)
	}
}

func TestOneStorageMoveAtATime(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	files := pg.NewDriveFileStore(pool)
	queue := jobs.NewQueue(pool, 0)
	alice, bob := testutil.NewUser(t, pool), testutil.NewUser(t, pool)

	if m, err := files.LatestStorageMove(ctx, alice, "storage_move"); err != nil || m != nil {
		t.Fatalf("latest before any = %+v, %v", m, err)
	}
	first, err := queue.Enqueue(ctx, alice, "storage_move", map[string]any{"direction": "to_drive"}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := queue.Enqueue(ctx, alice, "storage_move", map[string]any{"direction": "to_drive"}, 2); err == nil {
		t.Fatal("a second move was queued while the first waits")
	}
	// Another learner's move is theirs, and starts.
	if _, err := queue.Enqueue(ctx, bob, "storage_move", map[string]any{"direction": "to_server"}, 2); err != nil {
		t.Fatalf("bob's move: %v", err)
	}
	m, err := files.LatestStorageMove(ctx, alice, "storage_move")
	if err != nil || m == nil || m.ID != first || m.Status != "queued" {
		t.Fatalf("alice's latest = %+v, %v", m, err)
	}
	// Once it has finished, a new one may start.
	if _, err := pool.Exec(ctx, `UPDATE jobs SET status = 'done' WHERE id = $1`, first); err != nil {
		t.Fatal(err)
	}
	if _, err := queue.Enqueue(ctx, alice, "storage_move", map[string]any{"direction": "to_server"}, 2); err != nil {
		t.Fatalf("a move after the first finished: %v", err)
	}
}

func TestFileStorageIsServerUntilChosen(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	users := pg.NewUserStore(pool)
	alice := testutil.NewUser(t, pool)
	if s, err := users.FileStorage(ctx, alice); err != nil || s != "server" {
		t.Fatalf("default = %q, %v", s, err)
	}
	if err := users.SetFileStorage(ctx, alice, "drive"); err != nil {
		t.Fatal(err)
	}
	if u, err := users.GetUser(ctx, alice); err != nil || u.FileStorage != "drive" {
		t.Fatalf("user = %+v, %v", u, err)
	}
	if err := users.SetFileStorage(ctx, alice, "dropbox"); err == nil {
		t.Fatal("the column took a choice that is not server or drive")
	}
	if _, err := users.FileStorage(ctx, testutil.NewUser(t, pool)); err != nil {
		t.Fatal(err)
	}
	if err := users.SetFileStorage(ctx, [16]byte{1}, "drive"); !errors.Is(err, store.ErrUserNotFound) {
		t.Fatalf("an unknown user = %v", err)
	}
}
