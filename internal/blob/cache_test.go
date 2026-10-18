package blob_test

import (
	"bytes"
	"errors"
	"io"
	"io/fs"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
)

// onDisk totals the committed entries under dir, and counts temporary files.
func onDisk(t *testing.T, dir string) (total int64, temps int) {
	t.Helper()
	_ = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		if strings.HasPrefix(d.Name(), ".tmp-") {
			temps++
			return nil
		}
		info, _ := d.Info()
		total += info.Size()
		return nil
	})
	return total, temps
}

func TestCacheNeverExceedsItsCap(t *testing.T) {
	dir := t.TempDir()
	const max = 1000
	c, err := blob.NewCache(dir, max)
	if err != nil {
		t.Fatal(err)
	}
	rng := rand.New(rand.NewSource(7))
	users := []uuid.UUID{uuid.New(), uuid.New()}
	for i := 0; i < 200; i++ {
		data := make([]byte, 50+rng.Intn(300))
		rng.Read(data)
		if err := c.Put(users[i%2], data); err != nil {
			t.Fatal(err)
		}
		if c.Size() > max {
			t.Fatalf("put %d: the cache holds %d bytes over a cap of %d", i, c.Size(), max)
		}
		if total, _ := onDisk(t, dir); total > max {
			t.Fatalf("put %d: %d bytes on disk over a cap of %d", i, total, max)
		}
	}
	// A file larger than the whole cap is never cached.
	big := bytes.Repeat([]byte("b"), max+1)
	if err := c.Put(users[0], big); err != nil {
		t.Fatal(err)
	}
	if _, ok := c.Open(users[0], blob.Digest(big), int64(len(big))); ok {
		t.Fatal("a file over the cap was cached")
	}
}

func TestCacheEvictsTheLeastRecentlyUsed(t *testing.T) {
	c, err := blob.NewCache(t.TempDir(), 30)
	if err != nil {
		t.Fatal(err)
	}
	user := uuid.New()
	a, b, d := bytes.Repeat([]byte("a"), 10), bytes.Repeat([]byte("b"), 10), bytes.Repeat([]byte("c"), 15)
	for _, x := range [][]byte{a, b} {
		if err := c.Put(user, x); err != nil {
			t.Fatal(err)
		}
	}
	f, ok := c.Open(user, blob.Digest(a), 10)
	if !ok {
		t.Fatal("a is not cached")
	}
	f.Close()
	if err := c.Put(user, d); err != nil {
		t.Fatal(err)
	}
	if _, ok := c.Open(user, blob.Digest(b), 10); ok {
		t.Fatal("b, the least recently used, was kept")
	}
	for _, x := range [][]byte{a, d} {
		f, ok := c.Open(user, blob.Digest(x), int64(len(x)))
		if !ok {
			t.Fatalf("%q was evicted", x[:1])
		}
		got, _ := io.ReadAll(f)
		f.Close()
		if !bytes.Equal(got, x) {
			t.Fatalf("read back %q", got)
		}
	}
}

func TestCacheNeverServesAPartialFile(t *testing.T) {
	dir := t.TempDir()
	c, err := blob.NewCache(dir, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	user := uuid.New()
	whole := bytes.Repeat([]byte("0123456789"), 100)
	sha := blob.Digest(whole)

	// Half written: not there.
	stage, err := c.Stage(user)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := stage.Write(whole[:500]); err != nil {
		t.Fatal(err)
	}
	if _, ok := c.Open(user, sha, int64(len(whole))); ok {
		t.Fatal("a half-written entry was served")
	}
	// Finished with the wrong bytes: refused and gone.
	if err := stage.CommitAs(sha); !errors.Is(err, blob.ErrCorrupt) {
		t.Fatalf("commit of a partial file: %v", err)
	}
	if _, ok := c.Open(user, sha, int64(len(whole))); ok {
		t.Fatal("a partial entry was committed")
	}
	if total, temps := onDisk(t, dir); total != 0 || temps != 0 {
		t.Fatalf("left %d bytes and %d temporary files", total, temps)
	}

	// A crash mid-write leaves a temporary file; the next start removes it.
	crashed, _ := c.Stage(user)
	_, _ = crashed.Write(whole[:100])
	if _, temps := onDisk(t, dir); temps != 1 {
		t.Fatalf("%d temporary files before the restart", temps)
	}
	if _, err := blob.NewCache(dir, 1<<20); err != nil {
		t.Fatal(err)
	}
	if _, temps := onDisk(t, dir); temps != 0 {
		t.Fatalf("%d temporary files survived the restart", temps)
	}

	// An entry whose size is not what the caller expects is a miss.
	if err := c.Put(user, whole); err != nil {
		t.Fatal(err)
	}
	if _, ok := c.Open(user, sha, int64(len(whole))+1); ok {
		t.Fatal("an entry of the wrong size was served")
	}
}

func TestCacheSurvivesARestartAndKeepsUsersApart(t *testing.T) {
	dir := t.TempDir()
	c, err := blob.NewCache(dir, 100)
	if err != nil {
		t.Fatal(err)
	}
	alice, bob := uuid.New(), uuid.New()
	x := bytes.Repeat([]byte("x"), 40)
	_ = c.Put(alice, x)
	_ = c.Put(bob, x)
	if _, ok := c.Open(bob, blob.Digest(x), 40); !ok {
		t.Fatal("bob's entry is missing")
	}

	again, err := blob.NewCache(dir, 100)
	if err != nil {
		t.Fatal(err)
	}
	if again.Size() != 80 {
		t.Fatalf("after a restart the cache counts %d bytes", again.Size())
	}
	// A smaller cap evicts on start; bob's entry was used last and stays.
	smaller, err := blob.NewCache(dir, 50)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := smaller.Open(bob, blob.Digest(x), 40); !ok {
		t.Fatal("the most recently used entry was evicted")
	}
	if _, ok := smaller.Open(alice, blob.Digest(x), 40); ok {
		t.Fatal("the cache is over its new cap")
	}

	if err := smaller.DeleteUser(bob); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, bob.String())); !os.IsNotExist(err) {
		t.Fatalf("bob's cache directory is still there: %v", err)
	}
	if smaller.Size() != 0 {
		t.Fatalf("the cache still counts %d bytes", smaller.Size())
	}
}
