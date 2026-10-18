package blob_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
)

// drive_unavailable_test.go — drive-user-storage phase 3 in the backend.

// A learner whose Drive needs reconnecting can still delete the AnyTools
// side; the file stays in their Drive. Any other refusal keeps the row, so
// nothing points nowhere.
func TestDeletingWhileDriveNeedsReconnectDropsOnlyTheLonglaySide(t *testing.T) {
	f := newDriveFixture(t)
	ctx, user, id := context.Background(), uuid.New(), uuid.New()
	data := []byte("a recording kept in Drive")
	if err := f.drive.PutObject(ctx, user, "recordings", id, data); err != nil {
		t.Fatal(err)
	}

	f.remote.delErr = errors.New("drive: HTTP 503")
	if err := f.drive.DeleteObject(ctx, user, "recordings", id); err == nil {
		t.Fatal("a failed Drive delete was reported as done")
	}
	if _, err := f.index.GetDriveFile(ctx, user, "recordings", id.String()); err != nil {
		t.Fatalf("a failed Drive delete dropped the row: %v", err)
	}

	f.remote.delErr = fmt.Errorf("%w: needs reconnect", blob.ErrReconnect)
	if err := f.drive.DeleteObject(ctx, user, "recordings", id); err != nil {
		t.Fatalf("delete while Drive needs reconnecting: %v", err)
	}
	if _, err := f.index.GetDriveFile(ctx, user, "recordings", id.String()); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("the row outlived the delete: %v", err)
	}
	if _, ok := f.cache.Open(user, blob.Digest(data), int64(len(data))); ok {
		t.Fatal("the cached copy outlived the delete")
	}
	f.remote.only(t) // still in the learner's Drive
}

// A full Drive and a broken connection refuse the write, and nothing is kept
// on the server or in the cache instead.
func TestARefusedWriteNamesItsReasonAndKeepsNothing(t *testing.T) {
	for _, refusal := range []error{blob.ErrRemoteFull, fmt.Errorf("%w: revoked", blob.ErrReconnect)} {
		f := newDriveFixture(t)
		ctx, user := context.Background(), uuid.New()
		f.remote.putErr = refusal
		_, err := f.drive.PutOriginal(ctx, user, []byte("%PDF-1.7 refused"))
		if !errors.Is(err, refusal) && !errors.Is(err, blob.ErrReconnect) {
			t.Fatalf("refused as %v", err)
		}
		if _, ok := blob.Unavailable(err); !ok {
			t.Fatalf("%v has no reason to show", err)
		}
		err = f.drive.WriteObject(ctx, user, "audio", uuid.New(), func(w io.Writer) error {
			_, err := w.Write([]byte("RIFF....WAVE"))
			return err
		})
		if _, ok := blob.Unavailable(err); !ok {
			t.Fatalf("a streamed write refused as %v", err)
		}
		for _, kind := range []string{"originals", "objects"} {
			if serverHas(t, f.local.Root(), kind, user) {
				t.Fatalf("a refused write left a file under %s/", kind)
			}
		}
		if n := f.cache.Size(); n != 0 {
			t.Fatalf("a refused write left %d bytes in the cache", n)
		}
	}
}
