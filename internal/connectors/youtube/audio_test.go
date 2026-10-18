package youtube_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/connectors/youtube"
)

// fakeYTDLP puts a yt-dlp on PATH that records its arguments, one per line,
// and then does what mode says. The mode lives in a file beside the script:
// the fetcher passes yt-dlp a bare environment, so an env var would not
// reach it. No network, no YouTube.
func fakeYTDLP(t *testing.T, mode string) (binDir string) {
	t.Helper()
	binDir = t.TempDir()
	script := `#!/bin/sh
here=$(dirname "$0")
mode=$(cat "$here/mode")
: > "$here/args"
for a in "$@"; do printf '%s\n' "$a" >> "$here/args"; done
echo $$ > "$here/pid"
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "-o" ]; then out="$a"; fi
  prev="$a"
done
case "$mode" in
  ok)
    f=$(printf '%s' "$out" | sed 's/%(ext)s/webm/')
    printf 'OggS-fake-audio' > "$f"
    echo "[download] 100% of 1.00MiB" ;;
  bot)
    echo "ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication." >&2
    exit 1 ;;
  private)
    echo "ERROR: [youtube] dQw4w9WgXcQ: Private video. Sign in if you've been granted access to this video" >&2
    exit 1 ;;
  toolarge)
    echo "[info] File is larger than max-filesize (612000000 bytes > 524288000 bytes). Aborting." ;;
  hang)
    sleep 30 &
    echo $! > "$here/child"
    wait ;;
esac
`
	if err := os.WriteFile(filepath.Join(binDir, "yt-dlp"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(binDir, "mode"), []byte(mode), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	return binDir
}

func readArgs(t *testing.T, binDir string) []string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(binDir, "args"))
	if err != nil {
		t.Fatal(err)
	}
	return strings.Split(strings.TrimSuffix(string(data), "\n"), "\n")
}

func TestYTDLPArgumentsAreExactlyTheSpecifiedOnes(t *testing.T) {
	bin := fakeYTDLP(t, "ok")
	dir := t.TempDir()
	path, err := youtube.NewAudioFetcher("").Fetch(context.Background(), "dQw4w9WgXcQ", dir)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(path) != dir || filepath.Ext(path) != ".webm" {
		t.Fatalf("path %q", path)
	}
	want := []string{
		"-f", "bestaudio", "--no-playlist", "--max-filesize", "500M", "--no-config", "--no-cache-dir",
		"-o", filepath.Join(dir, "source-audio.%(ext)s"),
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
	}
	if got := readArgs(t, bin); !reflect.DeepEqual(got, want) {
		t.Fatalf("args\n got %q\nwant %q", got, want)
	}
}

func TestOnlyAValidatedIDEverReachesYTDLP(t *testing.T) {
	bin := fakeYTDLP(t, "ok")
	for _, id := range []string{
		"", "dQw4w9WgXc", "dQw4w9WgXcQQ", "--exec=sh", "dQw4w9WgXc;", "https://evil.example/x",
		"dQw4w9WgX Q", "../../../et",
	} {
		if _, err := youtube.NewAudioFetcher("").Fetch(context.Background(), id, t.TempDir()); err == nil {
			t.Errorf("%q was fetched", id)
		}
	}
	if _, err := os.Stat(filepath.Join(bin, "args")); !os.IsNotExist(err) {
		t.Fatal("yt-dlp ran for an invalid id")
	}
}

func TestABotCheckMapsToBlocked(t *testing.T) {
	fakeYTDLP(t, "bot")
	_, err := youtube.NewAudioFetcher("").Fetch(context.Background(), "dQw4w9WgXcQ", t.TempDir())
	if !errors.Is(err, youtube.ErrAudioBlocked) {
		t.Fatalf("err %v", err)
	}
}

func TestOtherRefusalsMapToTheirReasons(t *testing.T) {
	fakeYTDLP(t, "private")
	if _, err := youtube.NewAudioFetcher("").Fetch(context.Background(), "dQw4w9WgXcQ", t.TempDir()); !errors.Is(err, youtube.ErrAudioUnavailable) {
		t.Fatalf("private: %v", err)
	}
	fakeYTDLP(t, "toolarge")
	if _, err := youtube.NewAudioFetcher("").Fetch(context.Background(), "dQw4w9WgXcQ", t.TempDir()); !errors.Is(err, youtube.ErrAudioTooLarge) {
		t.Fatalf("too large: %v", err)
	}
}

func TestATimeoutKillsYTDLPAndItsChildren(t *testing.T) {
	bin := fakeYTDLP(t, "hang")
	f := youtube.NewAudioFetcher("")
	f.Timeout = 500 * time.Millisecond
	start := time.Now()
	_, err := f.Fetch(context.Background(), "dQw4w9WgXcQ", t.TempDir())
	if !errors.Is(err, youtube.ErrAudioTimeout) {
		t.Fatalf("err %v", err)
	}
	if time.Since(start) > 10*time.Second {
		t.Fatal("the timeout did not stop yt-dlp")
	}
	for _, name := range []string{"pid", "child"} {
		raw, err := os.ReadFile(filepath.Join(bin, name))
		if err != nil {
			t.Fatal(err)
		}
		pid, _ := strconv.Atoi(strings.TrimSpace(string(raw)))
		// Signal 0 probes existence; the group kill reaped both.
		deadline := time.Now().Add(3 * time.Second)
		for syscall.Kill(pid, 0) == nil && time.Now().Before(deadline) {
			time.Sleep(50 * time.Millisecond)
		}
		if syscall.Kill(pid, 0) == nil {
			t.Errorf("%s %d is still running", name, pid)
		}
	}
}
