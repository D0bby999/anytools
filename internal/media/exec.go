// Package media runs the two media tools the API ships with (up-methods
// phase 21): yt-dlp, which fetches a public video's audio track
// (internal/connectors/youtube/audio.go), and ffmpeg, which normalises audio
// for a speech engine and cuts it into windows (ffmpeg.go).
//
// Both run as subprocesses with fixed argument lists, a bare environment, a
// bounded capture of what they print, and a deadline that kills the whole
// process group: yt-dlp may start ffmpeg itself, and a timeout that killed
// only the parent would leave the child writing into a directory the job is
// about to remove.
package media

import (
	"bytes"
	"context"
	"io"
	"os"
	"os/exec"
	"time"
)

// Command is a tool invocation run in dir with a bare environment. HOME is
// dir, so nothing the tool caches outlives the job; the API's own environment
// (database DSN, encryption key) is never passed on.
func Command(ctx context.Context, bin, dir string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Dir = dir
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + dir, "LANG=C.UTF-8"}
	killGroup(cmd)
	cmd.WaitDelay = 5 * time.Second
	return cmd
}

// Output is a bounded capture of a tool's stdout and stderr: the first 64 KB,
// enough for its error line, whatever it prints.
type Output struct{ bytes.Buffer }

const maxOutput = 64 << 10

func (b *Output) Write(p []byte) (int, error) {
	if room := maxOutput - b.Len(); room > 0 {
		if len(p) > room {
			b.Buffer.Write(p[:room])
		} else {
			b.Buffer.Write(p)
		}
	}
	return len(p), nil
}

// JobDir makes a per-job scratch directory under root (ANYTOOLS_DATA_DIR/tmp)
// and returns it with the function that removes it. The caller defers the
// removal at once, so the directory goes whether the job succeeds, fails or
// panics.
func JobDir(root, name string) (string, func(), error) {
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", func() {}, err
	}
	dir, err := os.MkdirTemp(root, name+"-")
	if err != nil {
		return "", func() {}, err
	}
	return dir, func() { _ = os.RemoveAll(dir) }, nil
}

// Materialize copies a stream into dir (a JobDir) for a tool that needs a
// path. A stored file has none when it lives in a learner's Drive
// (drive-user-storage phase 0), so ffmpeg and ffprobe read this copy, and the
// job directory's cleanup removes it with everything else. A failed copy
// removes what it wrote at once.
func Materialize(dir, name string, r io.Reader) (string, error) {
	f, err := os.CreateTemp(dir, name+"-*")
	if err != nil {
		return "", err
	}
	path := f.Name()
	_, err = io.Copy(f, r)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(path)
		return "", err
	}
	return path, nil
}
