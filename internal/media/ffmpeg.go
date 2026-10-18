package media

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// ffmpeg.go — audio normalised for a speech engine and cut into windows.
//
// Every window becomes 16 kHz mono Opus in Ogg at 24 kbit/s: what Whisper
// hears at anyway (it resamples everything to 16 kHz mono), and small
// enough that an hour-long window is about 11 MB, under OpenAI's and Groq's
// 25 MB upload limit. One file per window is what makes the job resumable
// through jobs.RunUnits: a retry re-sends one window, not the whole video.

// OutputMIME is the type of every window file.
const OutputMIME = "audio/ogg"

// MaxWindowBytes is the largest window a speech engine accepts (OpenAI's and
// Groq's 25 MB). A window over it is refused rather than sent to be refused.
const MaxWindowBytes = 25 << 20

// ToolTimeout bounds one ffmpeg or ffprobe run. Transcoding an hour of audio
// to Opus takes well under a minute on one core.
const ToolTimeout = 5 * time.Minute

// Window is a span of the audio in seconds. End zero means "to the end".
type Window struct {
	Start int
	End   int
}

// ErrWindowTooLarge is a normalised window over MaxWindowBytes.
var ErrWindowTooLarge = errors.New("media: an audio window is larger than a speech engine accepts")

// ErrUnreadable is audio ffmpeg could not decode.
var ErrUnreadable = errors.New("media: the audio could not be read")

// FFmpeg runs ffmpeg and ffprobe.
type FFmpeg struct {
	Bin, Probe string
	Timeout    time.Duration
}

// NewFFmpeg returns the tools at bin ("" is "ffmpeg" on PATH). ffprobe is
// looked for beside it.
func NewFFmpeg(bin string) *FFmpeg {
	if bin == "" {
		bin = "ffmpeg"
	}
	probe := "ffprobe"
	if strings.ContainsRune(bin, os.PathSeparator) {
		probe = filepath.Join(filepath.Dir(bin), "ffprobe")
	}
	return &FFmpeg{Bin: bin, Probe: probe, Timeout: ToolTimeout}
}

func (f *FFmpeg) timeout() time.Duration {
	if f.Timeout > 0 {
		return f.Timeout
	}
	return ToolTimeout
}

// Duration is the audio's length in seconds, from ffprobe.
func (f *FFmpeg) Duration(ctx context.Context, in string) (float64, error) {
	ctx, cancel := context.WithTimeout(ctx, f.timeout())
	defer cancel()
	cmd := Command(ctx, f.Probe, filepath.Dir(in),
		"-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", in)
	var out Output
	cmd.Stdout, cmd.Stderr = &out, &out
	if err := cmd.Run(); err != nil {
		return 0, fmt.Errorf("%w: ffprobe failed", ErrUnreadable)
	}
	d, err := strconv.ParseFloat(strings.TrimSpace(out.String()), 64)
	if err != nil || d <= 0 {
		return 0, fmt.Errorf("%w: no duration", ErrUnreadable)
	}
	return d, nil
}

// SplitArgs is ffmpeg's command line for one window. Exported for the test.
func SplitArgs(in, out string, w Window) []string {
	args := []string{"-nostdin", "-hide_banner", "-v", "error", "-y", "-ss", strconv.Itoa(w.Start)}
	if w.End > w.Start {
		args = append(args, "-t", strconv.Itoa(w.End-w.Start))
	}
	return append(args, "-i", in,
		"-vn", "-map", "0:a:0", "-ac", "1", "-ar", "16000",
		"-c:a", "libopus", "-b:a", "24k", "-application", "voip",
		"-f", "ogg", out)
}

// Split normalises in into one Ogg Opus file per window, written to dir, and
// returns their paths in window order.
func (f *FFmpeg) Split(ctx context.Context, in, dir string, windows []Window) ([]string, error) {
	out := make([]string, 0, len(windows))
	for i, w := range windows {
		path := filepath.Join(dir, fmt.Sprintf("window-%03d.ogg", i))
		if err := f.run(ctx, dir, SplitArgs(in, path, w)); err != nil {
			return nil, err
		}
		st, err := os.Stat(path)
		if err != nil || st.Size() == 0 {
			return nil, fmt.Errorf("%w: window %d is empty", ErrUnreadable, i)
		}
		if st.Size() > MaxWindowBytes {
			return nil, ErrWindowTooLarge
		}
		out = append(out, path)
	}
	return out, nil
}

func (f *FFmpeg) run(ctx context.Context, dir string, args []string) error {
	ctx, cancel := context.WithTimeout(ctx, f.timeout())
	defer cancel()
	cmd := Command(ctx, f.Bin, dir, args...)
	var out Output
	cmd.Stdout, cmd.Stderr = &out, &out
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("media: ffmpeg: %w", ctx.Err())
		}
		return fmt.Errorf("%w: ffmpeg failed", ErrUnreadable)
	}
	return nil
}
