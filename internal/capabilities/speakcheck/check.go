// Package speakcheck is the read-aloud check (plans/261020-1155-open-source-
// adds, phase 2): the learner selects a passage while reading, records
// themselves reading it aloud, and sees which words a speech engine did not
// get. The idea is gemini-teacher's and ai-pronunciation-trainer's; nothing of
// their code is used.
//
// What it is not: a pronunciation score. It says whether a listener — here a
// speech engine — understood each word, which is the test up's speaking
// chapter sets; an accent that is understood is fine.
//
// The passage must be on the stored page, as a vocabulary selection must, so
// the route is not a free transcriber. Nothing is stored: the take is deleted
// once heard, and the result lives on the page.
package speakcheck

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning/worksheet"
	"github.com/D0bby999/anytools/internal/media"
	"github.com/D0bby999/anytools/internal/vocab"
)

// Limits on one check.
const (
	// MaxSeconds is the longest take: a passage of a few sentences.
	MaxSeconds = 30
	// MaxBytes is the largest take. Thirty seconds of MediaRecorder's Opus is
	// well under a megabyte; Safari's AAC in MP4 is larger.
	MaxBytes = 4 << 20
	// MaxWords and MaxTextLen bound the passage.
	MaxWords   = 80
	MaxTextLen = 1000
)

// Errors the API tells apart.
var (
	ErrInvalid = errors.New("speakcheck: invalid")
	// ErrUnreadable: the take is not audio ffmpeg can read.
	ErrUnreadable = errors.New("speakcheck: the recording could not be read")
	// ErrNoEngine: the learner has no speech-to-text connection and the
	// server runs no built-in engine.
	ErrNoEngine = errors.New("speakcheck: no speech-to-text is set up")
	// ErrBusy: the server's shared engine did not answer in time, or at all.
	ErrBusy = errors.New("speakcheck: the server's speech engine did not answer")
	// ErrQuota: today's built-in minutes are spent.
	ErrQuota = errors.New("speakcheck: today's built-in transcription minutes are used up")
	// ErrEngine: the learner's own connection failed.
	ErrEngine = errors.New("speakcheck: your speech-to-text connection failed")
)

// Pages reads the stored text of a reading workspace's page. It answers
// vocab.ErrNotFound for a workspace that is not the caller's and
// vocab.ErrNoText for a document with no parse (app.vocabPages).
type Pages interface {
	WorkspacePage(ctx context.Context, userID, workspaceID uuid.UUID, page int) (uuid.UUID, string, error)
}

// Audio is ffmpeg: a take's length, and the take as one normalised window.
type Audio interface {
	Duration(ctx context.Context, in string) (float64, error)
	Split(ctx context.Context, in, dir string, windows []media.Window) ([]string, error)
}

// Heard is what an engine heard, and which engine.
type Heard struct {
	Text string
	By   By
}

// By names the engine: the learner's own connection ("own", with its name),
// or the server's built-in transcription ("builtin").
type By struct {
	Kind string `json:"kind"`
	Name string `json:"name,omitempty"`
}

// Ears hears a normalised take: the learner's own stt route first, then the
// server's engine. seconds is the take's length, for the built-in allowance.
type Ears interface {
	Hear(ctx context.Context, userID uuid.UUID, path, mime, lang string, seconds int) (Heard, error)
}

// Service runs a check.
type Service struct {
	pages Pages
	audio Audio
	ears  Ears
	tmp   string
}

// New builds the Service. tmp is where a take is written while it is heard.
func New(pages Pages, audio Audio, ears Ears, tmp string) *Service {
	return &Service{pages: pages, audio: audio, ears: ears, tmp: tmp}
}

// Input is one check: the passage as selected on a page, and the take.
type Input struct {
	WorkspaceID uuid.UUID
	Page        int
	Text        string
	Take        []byte
}

// Result is the comparison, with what was heard and by which engine.
type Result struct {
	Alignment
	Heard string `json:"heard"`
	By    By     `json:"by"`
	Lang  string `json:"lang"`
}

// Check hears the take and compares it with the passage.
func (s *Service) Check(ctx context.Context, userID uuid.UUID, in Input) (*Result, error) {
	text := strings.TrimSpace(in.Text)
	switch n := len(tokens(text)); {
	case n == 0:
		return nil, fmt.Errorf("%w: select the passage to read aloud", ErrInvalid)
	case n > MaxWords || utf8.RuneCountInString(text) > MaxTextLen:
		return nil, fmt.Errorf("%w: select at most %d words to read aloud", ErrInvalid, MaxWords)
	case len(in.Take) == 0:
		return nil, fmt.Errorf("%w: record yourself reading it first", ErrInvalid)
	case len(in.Take) > MaxBytes:
		return nil, fmt.Errorf("%w: a take is at most %d seconds", ErrInvalid, MaxSeconds)
	}
	if _, ok := worksheet.SniffAudio(in.Take); !ok {
		return nil, ErrUnreadable
	}
	_, page, err := s.pages.WorkspacePage(ctx, userID, in.WorkspaceID, in.Page)
	if err != nil {
		return nil, err
	}
	if !vocab.SelectionOnPage(text, page) {
		return nil, fmt.Errorf("%w: that passage is not on this page of the document", ErrInvalid)
	}

	dir, err := os.MkdirTemp(s.tmp, "speakcheck-")
	if err != nil {
		return nil, fmt.Errorf("speakcheck: %w", err)
	}
	defer os.RemoveAll(dir)
	take := filepath.Join(dir, "take")
	if err := os.WriteFile(take, in.Take, 0o600); err != nil {
		return nil, fmt.Errorf("speakcheck: %w", err)
	}
	length, err := s.audio.Duration(ctx, take)
	if err != nil {
		return nil, ErrUnreadable
	}
	// A take the recorder stopped at 30 s may measure a fraction over.
	if length > MaxSeconds+1 {
		return nil, fmt.Errorf("%w: a take is at most %d seconds", ErrInvalid, MaxSeconds)
	}
	windows, err := s.audio.Split(ctx, take, dir, []media.Window{{Start: 0, End: MaxSeconds + 1}})
	if err != nil || len(windows) != 1 {
		return nil, ErrUnreadable
	}
	lang := vocab.DetectLang(page)
	// The allowance counts the take to the nearest second: a container
	// measures a few milliseconds over what was recorded.
	heard, err := s.ears.Hear(ctx, userID, windows[0], media.OutputMIME, lang, max(1, int(math.Round(length))))
	if err != nil {
		return nil, err
	}
	return &Result{Alignment: Align(text, heard.Text), Heard: strings.TrimSpace(heard.Text), By: heard.By, Lang: lang}, nil
}
