package media_test

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/media"
)

// The real ffmpeg, on a recorded 70-second MP3 (a tone, made once with
// ffmpeg's lavfi sine source and committed). Skipped where ffmpeg is absent;
// the API image ships it (deploy/Dockerfile.api).
func TestSeventySecondMP3BecomesTwoWindowsUnderTheUploadLimit(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg is not installed")
	}
	in, err := filepath.Abs(filepath.Join("testdata", "seventy-seconds.mp3"))
	if err != nil {
		t.Fatal(err)
	}
	f := media.NewFFmpeg("")
	ctx := context.Background()
	d, err := f.Duration(ctx, in)
	if err != nil || d < 69.5 || d > 70.5 {
		t.Fatalf("duration %v err %v", d, err)
	}

	dir := t.TempDir()
	files, err := f.Split(ctx, in, dir, []media.Window{{Start: 0, End: 60}, {Start: 60}})
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 2 {
		t.Fatalf("%d windows", len(files))
	}
	for i, want := range []float64{60, 10} {
		st, err := os.Stat(files[i])
		if err != nil || st.Size() == 0 || st.Size() >= media.MaxWindowBytes {
			t.Fatalf("window %d: %v size %d", i, err, st.Size())
		}
		got, err := f.Duration(ctx, files[i])
		if err != nil || got < want-0.5 || got > want+0.5 {
			t.Errorf("window %d lasts %v, want %v (err %v)", i, got, want, err)
		}
		// Normalised: 16 kHz mono Opus.
		out, err := exec.Command("ffprobe", "-v", "error", "-select_streams", "a:0",
			"-show_entries", "stream=codec_name,sample_rate,channels", "-of", "csv=p=0", files[i]).Output()
		if err != nil || string(out) != "opus,48000,1\n" && string(out) != "opus,16000,1\n" {
			t.Errorf("window %d stream %q err %v", i, out, err)
		}
	}
}

func TestSplitArgsAreFixed(t *testing.T) {
	got := media.SplitArgs("/tmp/j/in.webm", "/tmp/j/window-000.ogg", media.Window{Start: 1200, End: 2400})
	want := []string{"-nostdin", "-hide_banner", "-v", "error", "-y", "-ss", "1200", "-t", "1200",
		"-i", "/tmp/j/in.webm", "-vn", "-map", "0:a:0", "-ac", "1", "-ar", "16000",
		"-c:a", "libopus", "-b:a", "24k", "-application", "voip", "-f", "ogg", "/tmp/j/window-000.ogg"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("args\n got %v\nwant %v", got, want)
	}
}

// A tool that hangs is killed at its deadline, children included.
func TestAHangingToolIsKilled(t *testing.T) {
	bin := filepath.Join(t.TempDir(), "ffmpeg")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\nsleep 30 &\nwait\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	f := media.NewFFmpeg(bin)
	f.Timeout = 300 * time.Millisecond
	start := time.Now()
	_, err := f.Split(context.Background(), "in", t.TempDir(), []media.Window{{}})
	if err == nil || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err %v", err)
	}
	if time.Since(start) > 10*time.Second {
		t.Fatal("the hanging tool was not killed")
	}
}

func TestJobDirIsRemovedByItsCleanup(t *testing.T) {
	root := filepath.Join(t.TempDir(), "tmp")
	dir, done, err := media.JobDir(root, "transcribe")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "source-audio.webm"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	done()
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("job dir survived: %v", err)
	}
	entries, _ := os.ReadDir(root)
	if len(entries) != 0 {
		t.Fatalf("%d entries left under tmp", len(entries))
	}
}
