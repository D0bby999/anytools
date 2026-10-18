package pg_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// Drive-user-storage phase 3: counting a learner's files in Drive, clearing
// their missing marks after a reconnect and forgetting their folders each
// touch that learner's rows and nobody else's.
func TestRecoveringOneLearnersDriveLeavesAnothersAlone(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	files := pg.NewDriveFileStore(pool)
	alice, bob := testutil.NewUser(t, pool), testutil.NewUser(t, pool)
	digest := blob.Digest([]byte("kept in Drive"))
	for _, u := range []struct {
		id    uuid.UUID
		drive string
	}{{alice, "aliceFile_1"}, {bob, "bobFile_1"}} {
		if err := files.PutDriveFile(ctx, blob.DriveFile{UserID: u.id, Kind: blob.KindOriginal, Key: digest,
			DriveFileID: u.drive, SHA256: digest, Bytes: 13}); err != nil {
			t.Fatal(err)
		}
		if err := files.MarkDriveFileMissing(ctx, u.id, blob.KindOriginal, digest); err != nil {
			t.Fatal(err)
		}
		if err := files.SaveFolder(ctx, u.id, blob.FolderRoot, u.drive+"_root"); err != nil {
			t.Fatal(err)
		}
	}

	if n, bytes, err := files.CountDriveFiles(ctx, alice); err != nil || n != 1 || bytes != 13 {
		t.Fatalf("alice has %d files, %d bytes in Drive (%v)", n, bytes, err)
	}
	if err := files.ClearDriveFilesMissing(ctx, alice); err != nil {
		t.Fatal(err)
	}
	if err := files.ForgetFolders(ctx, alice); err != nil {
		t.Fatal(err)
	}

	if row, _ := files.GetDriveFile(ctx, alice, blob.KindOriginal, digest); row == nil || row.MissingAt != nil {
		t.Fatal("alice's mark was not cleared")
	}
	if got, _ := files.ListFolders(ctx, alice); len(got) != 0 {
		t.Fatalf("alice's folders were kept: %v", got)
	}
	if row, _ := files.GetDriveFile(ctx, bob, blob.KindOriginal, digest); row == nil || row.MissingAt == nil {
		t.Fatal("clearing alice's marks cleared bob's")
	}
	if got, _ := files.ListFolders(ctx, bob); got[blob.FolderRoot] != "bobFile_1_root" {
		t.Fatalf("forgetting alice's folders forgot bob's: %v", got)
	}
	if n, _, _ := files.CountDriveFiles(ctx, bob); n != 1 {
		t.Fatalf("bob has %d files", n)
	}
}
