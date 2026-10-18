package youtube

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/D0bby999/anytools/internal/media"
)

// audio.go — a public video's audio track, fetched by yt-dlp, for an engine
// that hears audio rather than reading a URL (up-methods phase 21: the
// built-in Whisper, the learner's Groq or OpenAI key).
//
// The owner's boundary (2026-10-02): the audio is fetched to a temporary
// file only to transcribe it, and deleted when the job ends; it is never
// stored or served. AnyTools never passes cookies or a proxy to get around
// YouTube refusing the server: a refusal is reported as one.
//
// yt-dlp runs as a subprocess with a fixed argument list. The only variable
// in it is the output path, which the server makes, and the watch URL, which
// is built from an id that passed ValidID; nothing a learner typed reaches
// the command line.

// AudioTimeout bounds one download.
const AudioTimeout = 10 * time.Minute

// MaxAudioFileSize is yt-dlp's --max-filesize: a 4-hour talk's audio track is
// a few hundred megabytes at most.
const MaxAudioFileSize = "500M"

// Errors the transcription job tells apart.
var (
	// ErrAudioBlocked is YouTube refusing the server (its bot check, or a
	// rate limit). Retrying from the same address will not help.
	ErrAudioBlocked = errors.New("youtube: YouTube blocked this server")
	// ErrAudioUnavailable is a private, removed or region-locked video.
	ErrAudioUnavailable = errors.New("youtube: the video's audio is not publicly available")
	// ErrAudioTooLarge is an audio track over MaxAudioFileSize.
	ErrAudioTooLarge = errors.New("youtube: the video's audio is too large to fetch")
	// ErrAudioTimeout is a download that ran past AudioTimeout.
	ErrAudioTimeout = errors.New("youtube: the audio download took too long")
	// ErrAudioFailed is any other failure.
	ErrAudioFailed = errors.New("youtube: the audio could not be fetched")
)

// AudioFetcher runs yt-dlp.
type AudioFetcher struct {
	// Bin is the yt-dlp executable, looked up on PATH when it has no slash.
	Bin string
	// Timeout bounds one download; zero is AudioTimeout.
	Timeout time.Duration
}

// NewAudioFetcher returns a fetcher for bin ("" is "yt-dlp").
func NewAudioFetcher(bin string) *AudioFetcher {
	if bin == "" {
		bin = "yt-dlp"
	}
	return &AudioFetcher{Bin: bin, Timeout: AudioTimeout}
}

// AudioArgs is yt-dlp's whole command line for one video. Exported so the
// test can pin it exactly.
func AudioArgs(id, outTemplate string) []string {
	return []string{
		"-f", "bestaudio",
		"--no-playlist",
		"--max-filesize", MaxAudioFileSize,
		"--no-config",
		"--no-cache-dir",
		"-o", outTemplate,
		WatchURL(id),
	}
}

// audioBase is the output file's name before yt-dlp adds the extension.
const audioBase = "source-audio"

// Fetch downloads id's best audio track into dir and returns the file's path.
// dir is the caller's: the job makes it, and removes it whatever happens.
func (f *AudioFetcher) Fetch(ctx context.Context, id, dir string) (string, error) {
	if !ValidID(id) {
		return "", errors.New("youtube: invalid id")
	}
	timeout := f.Timeout
	if timeout <= 0 {
		timeout = AudioTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := media.Command(ctx, f.Bin, dir, AudioArgs(id, filepath.Join(dir, audioBase+".%(ext)s"))...)
	var out media.Output
	cmd.Stdout, cmd.Stderr = &out, &out

	runErr := cmd.Run()
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return "", ErrAudioTimeout
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	text := out.String()
	if runErr != nil {
		return "", classify(text)
	}
	path, err := findAudio(dir)
	if err != nil {
		// yt-dlp exits 0 when --max-filesize skips the download.
		if strings.Contains(text, "max-filesize") {
			return "", ErrAudioTooLarge
		}
		return "", err
	}
	return path, nil
}

// classify maps yt-dlp's output to the reason the learner is told. The
// phrases are YouTube's own ("Sign in to confirm you're not a bot") as yt-dlp
// relays them, matched loosely because the apostrophe varies.
func classify(text string) error {
	lower := strings.ToLower(text)
	switch {
	case strings.Contains(lower, "not a bot"), strings.Contains(lower, "sign in to confirm"),
		strings.Contains(lower, "http error 429"), strings.Contains(lower, "too many requests"):
		return ErrAudioBlocked
	case strings.Contains(lower, "private video"), strings.Contains(lower, "video unavailable"),
		strings.Contains(lower, "not available in your country"), strings.Contains(lower, "members-only"),
		strings.Contains(lower, "this video has been removed"), strings.Contains(lower, "age-restricted"):
		return ErrAudioUnavailable
	case strings.Contains(lower, "max-filesize"):
		return ErrAudioTooLarge
	}
	return ErrAudioFailed
}

// findAudio is the one finished file yt-dlp wrote.
func findAudio(dir string) (string, error) {
	matches, err := filepath.Glob(filepath.Join(dir, audioBase+".*"))
	if err != nil {
		return "", err
	}
	for _, m := range matches {
		if strings.HasSuffix(m, ".part") || strings.HasSuffix(m, ".ytdl") {
			continue
		}
		if st, err := os.Stat(m); err == nil && st.Mode().IsRegular() && st.Size() > 0 {
			return m, nil
		}
	}
	return "", fmt.Errorf("%w: no audio file was written", ErrAudioFailed)
}
