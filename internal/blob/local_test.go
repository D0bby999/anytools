package blob_test

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
)

func newStore(t *testing.T) (*blob.Local, string) {
	t.Helper()
	dir := t.TempDir()
	store, err := blob.NewLocal(dir)
	if err != nil {
		t.Fatalf("NewLocal: %v", err)
	}
	return store, dir
}

func TestOriginalsRoundTripByDigest(t *testing.T) {
	store, _ := newStore(t)
	ctx := context.Background()
	user := uuid.New()
	data := []byte("%PDF-1.4 some bytes")

	digest, err := store.PutOriginal(ctx, user, data)
	if err != nil {
		t.Fatalf("PutOriginal: %v", err)
	}
	if digest != blob.Digest(data) {
		t.Fatalf("PutOriginal returned %q, want the content digest", digest)
	}

	got, err := store.GetOriginal(ctx, user, digest)
	if err != nil {
		t.Fatalf("GetOriginal: %v", err)
	}
	if string(got) != string(data) {
		t.Fatalf("round trip changed the bytes")
	}

	// Writing the same bytes twice is a no-op, which is what makes an
	// interrupted upload safe to retry.
	again, err := store.PutOriginal(ctx, user, data)
	if err != nil || again != digest {
		t.Fatalf("second write: %q %v", again, err)
	}
}

// Content addressing must not become a cross-tenant read: knowing another
// user's digest must not be enough to fetch their file.
func TestOriginalsAreScopedByUser(t *testing.T) {
	store, _ := newStore(t)
	ctx := context.Background()
	alice, bob := uuid.New(), uuid.New()

	digest, err := store.PutOriginal(ctx, alice, []byte("alice's confidential document"))
	if err != nil {
		t.Fatalf("PutOriginal: %v", err)
	}

	if _, err := store.GetOriginal(ctx, bob, digest); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("bob read alice's blob by digest: %v", err)
	}
}

func TestGetOriginalRejectsAMalformedDigest(t *testing.T) {
	store, _ := newStore(t)
	ctx := context.Background()
	user := uuid.New()

	// Every one of these is a path-traversal attempt dressed as a digest. The
	// check is on shape — 64 lowercase hex characters — so none of them can
	// reach the filesystem at all.
	for _, bad := range []string{
		"", "short", strings.Repeat("a", 63), strings.Repeat("a", 65),
		"../../../../etc/passwd",
		strings.Repeat("a", 62) + "/x",
		strings.Repeat("A", 64), // uppercase is not the shape we write
		strings.Repeat("g", 64), // not hex
	} {
		if _, err := store.GetOriginal(ctx, user, bad); err == nil {
			t.Fatalf("GetOriginal(%q) succeeded", bad)
		}
	}
}

func TestParsedIsVersionedSoAFailedReparseCannotOverwrite(t *testing.T) {
	store, _ := newStore(t)
	ctx := context.Background()
	user, doc := uuid.New(), uuid.New()

	v1, err := store.PutParsed(ctx, user, doc, 1, "# version one")
	if err != nil {
		t.Fatalf("PutParsed v1: %v", err)
	}
	v2, err := store.PutParsed(ctx, user, doc, 2, "# version two")
	if err != nil {
		t.Fatalf("PutParsed v2: %v", err)
	}
	if v1 == v2 {
		t.Fatal("two versions wrote to the same path; a failed re-parse would clobber the copy the viewer is serving")
	}

	for path, want := range map[string]string{v1: "# version one", v2: "# version two"} {
		got, err := store.GetParsed(ctx, path)
		if err != nil {
			t.Fatalf("GetParsed(%s): %v", path, err)
		}
		if got != want {
			t.Fatalf("GetParsed(%s) = %q, want %q", path, got, want)
		}
	}
}

// documents.parsed_markdown_path is a column only this package writes — but a
// migration or a manual UPDATE can change that, and the cost of checking is one
// string comparison.
func TestGetParsedRefusesAPathOutsideTheDataDirectory(t *testing.T) {
	store, dir := newStore(t)
	ctx := context.Background()

	outside := filepath.Join(t.TempDir(), "secret.md")
	if err := os.WriteFile(outside, []byte("not ours"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	for _, path := range []string{
		outside,
		filepath.Join(dir, "..", filepath.Base(outside)),
		"/etc/passwd",
	} {
		if _, err := store.GetParsed(ctx, path); err == nil {
			t.Fatalf("GetParsed(%q) escaped the data directory", path)
		}
	}
}

func TestGetParsedReportsAMissingFileAsNotFound(t *testing.T) {
	store, dir := newStore(t)
	if _, err := store.GetParsed(context.Background(), filepath.Join(dir, "parsed", "nope.md")); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

// Deleting a document removes its parsed versions but keeps the original: the
// original is addressed by content digest and another document in another
// knowledge base may be the same file.
func TestDeleteDocumentRemovesParsedButKeepsTheOriginal(t *testing.T) {
	store, _ := newStore(t)
	ctx := context.Background()
	user, doc := uuid.New(), uuid.New()
	data := []byte("shared source file")

	digest, err := store.PutOriginal(ctx, user, data)
	if err != nil {
		t.Fatalf("PutOriginal: %v", err)
	}
	path, err := store.PutParsed(ctx, user, doc, 1, "# parsed")
	if err != nil {
		t.Fatalf("PutParsed: %v", err)
	}

	if err := store.DeleteDocument(ctx, user, doc); err != nil {
		t.Fatalf("DeleteDocument: %v", err)
	}
	if _, err := store.GetParsed(ctx, path); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("parsed content survived the delete: %v", err)
	}
	if _, err := store.GetOriginal(ctx, user, digest); err != nil {
		t.Fatalf("the original was removed too: %v", err)
	}

	// Deleting twice, and deleting a document that never existed, are both
	// no-ops: a delete handler's retry must not fail.
	if err := store.DeleteDocument(ctx, user, doc); err != nil {
		t.Fatalf("second delete: %v", err)
	}
	if err := store.DeleteDocument(ctx, uuid.New(), uuid.New()); err != nil {
		t.Fatalf("delete for an unknown user: %v", err)
	}
}

// A torn write would leave a truncated PDF whose digest no longer matches its
// own filename. Writes go through a temp file and a rename, so a reader either
// sees the whole file or no file.
func TestConcurrentWritesOfTheSameBlobAreSafe(t *testing.T) {
	store, _ := newStore(t)
	ctx := context.Background()
	user := uuid.New()
	data := []byte(strings.Repeat("anytools", 4096))

	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := store.PutOriginal(ctx, user, data); err != nil {
				t.Errorf("PutOriginal: %v", err)
			}
		}()
	}
	wg.Wait()

	got, err := store.GetOriginal(ctx, user, blob.Digest(data))
	if err != nil {
		t.Fatalf("GetOriginal: %v", err)
	}
	if len(got) != len(data) {
		t.Fatalf("read %d bytes, wrote %d — a torn write survived", len(got), len(data))
	}

	// No temp files left behind.
	var leftovers []string
	_ = filepath.Walk(store.Root(), func(path string, info os.FileInfo, err error) error {
		if err == nil && info != nil && !info.IsDir() && strings.HasPrefix(filepath.Base(path), ".tmp-") {
			leftovers = append(leftovers, path)
		}
		return nil
	})
	if len(leftovers) != 0 {
		t.Fatalf("temp files left behind: %v", leftovers)
	}
}

// The tree holds other people's documents. A group-readable upload directory is
// a data leak on any box with more than one service account.
func TestStoredFilesAreNotReadableByOthers(t *testing.T) {
	store, _ := newStore(t)
	ctx := context.Background()
	user := uuid.New()

	digest, err := store.PutOriginal(ctx, user, []byte("private"))
	if err != nil {
		t.Fatalf("PutOriginal: %v", err)
	}
	path := filepath.Join(store.Root(), "originals", user.String(), digest[:2], digest)
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if mode := info.Mode().Perm(); mode&0o077 != 0 {
		t.Fatalf("stored file mode is %o, want no group or other access", mode)
	}
}

func TestReadAllLimitedReportsOversize(t *testing.T) {
	data, tooBig, err := blob.ReadAllLimited(strings.NewReader("12345"), 10)
	if err != nil || tooBig || string(data) != "12345" {
		t.Fatalf("under the limit: %q %v %v", data, tooBig, err)
	}

	// Exactly at the limit is allowed; one byte over is not.
	if _, tooBig, _ := blob.ReadAllLimited(strings.NewReader("1234567890"), 10); tooBig {
		t.Fatal("a file exactly at the limit must be accepted")
	}
	if _, tooBig, _ := blob.ReadAllLimited(strings.NewReader("12345678901"), 10); !tooBig {
		t.Fatal("a file over the limit must be reported")
	}
}

func TestNewLocalRefusesAnEmptyDirectory(t *testing.T) {
	if _, err := blob.NewLocal(""); err == nil {
		t.Fatal("an empty data directory must be refused at boot, not discovered on the first upload")
	}
}

// SF-10: an object belongs to its row, not to its bytes. Deleting one row's
// object must leave a knowledge-base original with the same bytes, and
// another row's object with the same bytes, untouched.
func TestObjectsArePerRowNotPerContent(t *testing.T) {
	ctx := context.Background()
	l, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	user := uuid.New()
	data := []byte("%PDF-1.7 the same paper twice")
	digest, err := l.PutOriginal(ctx, user, data)
	if err != nil {
		t.Fatal(err)
	}
	a, b := uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{a, b} {
		if err := l.PutObject(ctx, user, "exam_papers", id, data); err != nil {
			t.Fatal(err)
		}
	}
	if err := l.DeleteObject(ctx, user, "exam_papers", a); err != nil {
		t.Fatal(err)
	}
	if _, err := l.GetObject(ctx, user, "exam_papers", a); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("deleted object still readable: %v", err)
	}
	if got, err := l.GetObject(ctx, user, "exam_papers", b); err != nil || string(got) != string(data) {
		t.Fatalf("the other row's object: %q, %v", got, err)
	}
	if got, err := l.GetOriginal(ctx, user, digest); err != nil || string(got) != string(data) {
		t.Fatalf("the original with the same bytes: %q, %v", got, err)
	}
	// Deleting twice is fine; the state asked for is "gone".
	if err := l.DeleteObject(ctx, user, "exam_papers", a); err != nil {
		t.Fatal(err)
	}

	// DeleteUser takes objects with everything else.
	if err := l.DeleteUser(ctx, user); err != nil {
		t.Fatal(err)
	}
	if _, err := l.GetObject(ctx, user, "exam_papers", b); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("object survived account deletion: %v", err)
	}
}

func TestObjectNamespaceCannotEscape(t *testing.T) {
	l, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	// Every method that names an object refuses a namespace or id that
	// could leave objects/<user>/.
	refused := func(ns string, id uuid.UUID) bool {
		ctx, user := context.Background(), uuid.New()
		_, getErr := l.GetObject(ctx, user, ns, id)
		_, openErr := l.OpenObject(ctx, user, ns, id)
		return l.PutObject(ctx, user, ns, id, []byte("x")) != nil &&
			l.WriteObject(ctx, user, ns, id, func(io.Writer) error { return nil }) != nil &&
			l.DeleteObject(ctx, user, ns, id) != nil &&
			getErr != nil && !errors.Is(getErr, blob.ErrNotFound) &&
			openErr != nil && !errors.Is(openErr, blob.ErrNotFound)
	}
	for _, ns := range []string{"", "..", "../x", "a/b", "Audio", strings.Repeat("a", 33)} {
		if !refused(ns, uuid.New()) {
			t.Errorf("namespace %q accepted", ns)
		}
	}
	if !refused("audio", uuid.Nil) {
		t.Error("nil id accepted")
	}
}
