package blob_test

import (
	"bytes"
	"context"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
)

func TestOpenObjectServesARange(t *testing.T) {
	store, _ := newStore(t)
	ctx, user, id := context.Background(), uuid.New(), uuid.New()
	data := []byte("RIFF0123456789abcdefghijklmnopqrstuvwxyz")
	if err := store.PutObject(ctx, user, "audio", id, data); err != nil {
		t.Fatal(err)
	}
	f, err := store.OpenObject(ctx, user, "audio", id)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if f.Size != int64(len(data)) || f.ModTime.IsZero() {
		t.Fatalf("size %d, time %v", f.Size, f.ModTime)
	}

	req := httptest.NewRequest(http.MethodGet, "/audio", nil)
	req.Header.Set("Range", "bytes=4-9")
	rec := httptest.NewRecorder()
	http.ServeContent(rec, req, "", f.ModTime, f)
	if rec.Code != http.StatusPartialContent || rec.Body.String() != "012345" {
		t.Fatalf("range: %d %q", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Range"); got != "bytes 4-9/40" {
		t.Fatalf("Content-Range %q", got)
	}
}

func TestOpenOriginalStreamsTheStoredBytes(t *testing.T) {
	store, _ := newStore(t)
	ctx, user := context.Background(), uuid.New()
	data := bytes.Repeat([]byte("recording "), 1000)
	digest, err := store.PutOriginal(ctx, user, data)
	if err != nil {
		t.Fatal(err)
	}
	f, err := store.OpenOriginal(ctx, user, digest)
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(f)
	f.Close()
	if err != nil || !bytes.Equal(got, data) || f.Size != int64(len(data)) {
		t.Fatalf("read %d bytes of %d (size %d): %v", len(got), len(data), f.Size, err)
	}
	// Another learner's digest is the same "not found" as a missing one.
	if _, err := store.OpenOriginal(ctx, uuid.New(), digest); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("another user's original: %v", err)
	}
	if _, err := store.OpenObject(ctx, user, "audio", uuid.New()); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("missing object: %v", err)
	}
	if _, err := store.OpenOriginal(ctx, user, "../../etc/passwd"); err == nil || errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("malformed digest: %v", err)
	}
}

// recordingBackend is a Local that counts the calls routed to it.
type recordingBackend struct {
	*blob.Local
	calls int
}

func (b *recordingBackend) PutObject(ctx context.Context, u uuid.UUID, ns string, id uuid.UUID, data []byte) error {
	b.calls++
	return b.Local.PutObject(ctx, u, ns, id, data)
}

func (b *recordingBackend) OpenObject(ctx context.Context, u uuid.UUID, ns string, id uuid.UUID) (*blob.File, error) {
	b.calls++
	return b.Local.OpenObject(ctx, u, ns, id)
}

func (b *recordingBackend) PutOriginal(ctx context.Context, u uuid.UUID, data []byte) (string, error) {
	b.calls++
	return b.Local.PutOriginal(ctx, u, data)
}

func (b *recordingBackend) DeleteUser(ctx context.Context, u uuid.UUID) error {
	b.calls++
	return b.Local.DeleteUser(ctx, u)
}

func TestRouterCallsTheBackendChosenForEachUser(t *testing.T) {
	ctx := context.Background()
	server, _ := newStore(t)
	elsewhere, _ := newStore(t)
	other := &recordingBackend{Local: elsewhere}
	alice, bob := uuid.New(), uuid.New()
	router := blob.NewRouter(server, func(_ context.Context, u uuid.UUID) (blob.Backend, error) {
		if u == bob {
			return other, nil
		}
		return server, nil
	})

	id := uuid.New()
	for _, u := range []uuid.UUID{alice, bob} {
		if err := router.PutObject(ctx, u, "recordings", id, []byte(u.String())); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := server.GetObject(ctx, alice, "recordings", id); err != nil {
		t.Fatalf("alice's file is not on the server: %v", err)
	}
	if _, err := server.GetObject(ctx, bob, "recordings", id); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("bob's file reached the server: %v", err)
	}
	f, err := router.OpenObject(ctx, bob, "recordings", id)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(f)
	f.Close()
	if string(got) != bob.String() {
		t.Fatalf("bob read %q", got)
	}
	if _, err := router.PutOriginal(ctx, bob, []byte("an upload")); err != nil {
		t.Fatal(err)
	}
	if other.calls != 3 {
		t.Fatalf("bob's backend saw %d calls, want 3", other.calls)
	}

	// Parsed Markdown stays on the server whoever the learner is.
	path, err := router.PutParsed(ctx, bob, uuid.New(), 1, "# parsed")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(path, server.Root()) {
		t.Fatalf("parsed text left the server: %s", path)
	}
	if got, err := router.GetParsed(ctx, path); err != nil || got != "# parsed" {
		t.Fatalf("parsed read back: %q, %v", got, err)
	}

	// DeleteUser clears the server's part and asks bob's backend for its own.
	if err := router.DeleteUser(ctx, bob); err != nil {
		t.Fatal(err)
	}
	if other.calls != 4 {
		t.Fatalf("bob's backend was not asked to delete: %d calls", other.calls)
	}
	if _, err := router.GetParsed(ctx, path); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("bob's parsed text outlived the account: %v", err)
	}
	if _, err := server.GetObject(ctx, alice, "recordings", id); err != nil {
		t.Fatalf("deleting bob took alice's file: %v", err)
	}
}

func TestRouterRefusesWhenTheBackendCannotBeChosen(t *testing.T) {
	server, _ := newStore(t)
	failed := errors.New("settings unavailable")
	router := blob.NewRouter(server, func(context.Context, uuid.UUID) (blob.Backend, error) { return nil, failed })
	ctx, user := context.Background(), uuid.New()
	if err := router.PutObject(ctx, user, "audio", uuid.New(), []byte("x")); !errors.Is(err, failed) {
		t.Fatalf("put: %v", err)
	}
	if _, err := router.PutOriginal(ctx, user, []byte("x")); !errors.Is(err, failed) {
		t.Fatalf("put original: %v", err)
	}
	// Nothing fell back to the server's disk.
	if _, err := server.OpenOriginal(ctx, user, blob.Digest([]byte("x"))); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("an upload fell back to the server: %v", err)
	}
}

func TestNewRouterKeepsEveryoneOnTheServerByDefault(t *testing.T) {
	server, _ := newStore(t)
	router := blob.NewRouter(server, nil)
	ctx, user, id := context.Background(), uuid.New(), uuid.New()
	if err := router.PutObject(ctx, user, "audio", id, []byte("wav")); err != nil {
		t.Fatal(err)
	}
	if got, err := server.GetObject(ctx, user, "audio", id); err != nil || string(got) != "wav" {
		t.Fatalf("server copy: %q, %v", got, err)
	}
	if router.Root() != server.Root() {
		t.Fatalf("root %s", router.Root())
	}
}

// A file's location is the backend's business: outside this package nothing
// asks for a path, because a file in a learner's Drive has none. Tests are
// walked too, so a fake cannot bring the method back.
func TestNothingOutsideBlobAsksForAPath(t *testing.T) {
	banned := map[string]bool{"ObjectPath": true, "OriginalPath": true}
	root := filepath.Join("..", "..")
	fset := token.NewFileSet()
	var walked int
	for _, dir := range []string{"internal", "cmd"} {
		err := filepath.WalkDir(filepath.Join(root, dir), func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				if p == filepath.Join(root, "internal", "blob") || d.Name() == "testdata" {
					return filepath.SkipDir
				}
				return nil
			}
			if !strings.HasSuffix(p, ".go") {
				return nil
			}
			file, err := parser.ParseFile(fset, p, nil, 0)
			if err != nil {
				return err
			}
			walked++
			ast.Inspect(file, func(n ast.Node) bool {
				switch n := n.(type) {
				case *ast.SelectorExpr:
					if banned[n.Sel.Name] {
						t.Errorf("%s: %s asks for a file's path; open it (blob.File) instead", fset.Position(n.Pos()), n.Sel.Name)
					}
				case *ast.FuncDecl:
					if banned[n.Name.Name] {
						t.Errorf("%s: %s declared outside internal/blob", fset.Position(n.Pos()), n.Name.Name)
					}
				}
				return true
			})
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if walked < 500 {
		t.Fatalf("walked %d Go files; the walk is broken", walked)
	}
}
