package media_test

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/media"
)

// failingReader gives some bytes, then fails: a Drive read cut off midway.
type failingReader struct{ sent bool }

var errCutOff = errors.New("connection reset")

func (r *failingReader) Read(p []byte) (int, error) {
	if r.sent {
		return 0, errCutOff
	}
	r.sent = true
	return copy(p, "half a recording"), nil
}

func entries(t *testing.T, dir string) []string {
	t.Helper()
	list, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range list {
		names = append(names, e.Name())
	}
	return names
}

func TestMaterializeLeavesNothingAfterTheJobDirectory(t *testing.T) {
	root := filepath.Join(t.TempDir(), "tmp")

	// Success: the copy is a file in the job directory, gone with it.
	dir, cleanup, err := media.JobDir(root, "transcribe-x")
	if err != nil {
		t.Fatal(err)
	}
	path, err := media.Materialize(dir, "recording", strings.NewReader("the whole recording"))
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(path) != dir {
		t.Fatalf("copy at %s, outside the job directory %s", path, dir)
	}
	if got, err := os.ReadFile(path); err != nil || string(got) != "the whole recording" {
		t.Fatalf("copy: %q, %v", got, err)
	}
	cleanup()
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the copy outlived its job directory: %v", err)
	}

	// Failure: the half-written copy goes at once, and the directory's
	// cleanup leaves nothing either.
	dir, cleanup, err = media.JobDir(root, "transcribe-y")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := media.Materialize(dir, "recording", &failingReader{}); !errors.Is(err, errCutOff) {
		t.Fatalf("a cut-off read: %v", err)
	}
	if left := entries(t, dir); len(left) != 0 {
		t.Fatalf("a failed copy left %v", left)
	}
	cleanup()
	if left := entries(t, root); len(left) != 0 {
		t.Fatalf("job directories left behind: %v", left)
	}
}

func TestMaterializeRefusesAMissingDirectory(t *testing.T) {
	_, err := media.Materialize(filepath.Join(t.TempDir(), "gone"), "recording", io.LimitReader(strings.NewReader("x"), 1))
	if err == nil {
		t.Fatal("copied into a directory that does not exist")
	}
}
