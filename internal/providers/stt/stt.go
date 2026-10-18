// Package stt is speech-to-text: one seam every engine AnyTools transcribes
// with sits behind (up-methods phase 21).
//
// Three engines serve it. Two of them are the same client:
//
//   - openaicompat: multipart POST {base}/audio/transcriptions, the request
//     shape OpenAI, Groq and speaches all accept. It serves the learner's own
//     OpenAI, Groq or OpenAI-compatible key.
//   - builtin: openaicompat aimed at the server's own speaches service
//     (ANYTOOLS_STT_URL), with no key. The one approved piece of platform
//     compute; metered per learner (pg.EngineUsage).
//   - gemini: the learner's Gemini key reading a public YouTube URL. It needs
//     no audio, so it does not implement Transcriber: it stays where it was
//     (internal/connectors/youtube/transcribe.go), unchanged.
//
// Every engine's answer becomes the same youtube.Cue list in
// internal/knowledge, which is what makes the stored transcript identical
// whoever heard it.
package stt

import (
	"context"
	"errors"
	"io"
	"math"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/D0bby999/anytools/internal/providers"
)

// Segment is one timed stretch of speech, in seconds from the start of the
// audio that was sent (not of the whole video: the caller adds the offset).
type Segment struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Text  string  `json:"text"`
}

// Segments is one transcription's result.
type Segments struct {
	// Language is a BCP-47 code, or "" when the engine did not say.
	Language string `json:"language,omitempty"`
	// Duration is the audio's length as the engine measured it; 0 if unknown.
	Duration float64 `json:"duration,omitempty"`
	// Timed is false when the engine returned text without times (OpenAI's
	// gpt-4o transcribe models answer `json` only). Segments then holds the
	// text split at sentence ends, spread evenly over the audio.
	Timed    bool      `json:"timed"`
	Segments []Segment `json:"segments"`
}

// Transcriber turns one stretch of audio into timed text. lang is a BCP-47
// hint, or "" to let the engine detect it.
type Transcriber interface {
	Transcribe(ctx context.Context, audio io.Reader, mime string, lang string) (*Segments, error)
}

// MaxUpload is OpenAI's and Groq's upload limit for one request. The ffmpeg
// step (internal/media) keeps every window under it.
const MaxUpload = 25 << 20

// maxResponse bounds the read of an engine's answer. Twenty minutes of speech
// with segment metadata is well under two megabytes.
const maxResponse = 8 << 20

// Errors a caller tells apart.
var (
	// ErrAudioTooLarge refuses audio over MaxUpload before anything is sent.
	ErrAudioTooLarge = errors.New("stt: the audio is larger than one request may carry")
	// ErrNoSpeech is a 200 with neither segments nor text.
	ErrNoSpeech = errors.New("stt: the engine returned no transcript")
	// ErrBadResponse is a 200 that is not the documented JSON.
	ErrBadResponse = errors.New("stt: the engine's answer was not a transcript")
	// ErrResponseTooLarge is an answer over maxResponse.
	ErrResponseTooLarge = errors.New("stt: the engine's answer was too large")
)

// Spread splits untimed text at sentence ends and gives each sentence a start
// proportional to its position in the text, over duration seconds. The times
// are estimates, which the transcript's label already says of every AI
// transcript.
func Spread(text string, duration float64) []Segment {
	sentences := splitSentences(text)
	if len(sentences) == 0 {
		return nil
	}
	total := 0
	for _, s := range sentences {
		total += utf8.RuneCountInString(s)
	}
	if duration <= 0 || math.IsNaN(duration) {
		duration = 0
	}
	out := make([]Segment, 0, len(sentences))
	at := 0
	for _, s := range sentences {
		start := 0.0
		if total > 0 {
			start = duration * float64(at) / float64(total)
		}
		at += utf8.RuneCountInString(s)
		end := 0.0
		if total > 0 {
			end = duration * float64(at) / float64(total)
		}
		out = append(out, Segment{Start: start, End: end, Text: s})
	}
	return out
}

func splitSentences(text string) []string {
	var out []string
	var b strings.Builder
	flush := func() {
		if s := strings.TrimSpace(b.String()); s != "" {
			out = append(out, s)
		}
		b.Reset()
	}
	runes := []rune(text)
	for i, r := range runes {
		b.WriteRune(r)
		switch r {
		case '.', '!', '?', '…', '。', '？', '！':
			if i+1 == len(runes) || runes[i+1] == ' ' || runes[i+1] == '\n' || r >= 0x3000 {
				flush()
			}
		case '\n':
			flush()
		}
	}
	flush()
	return out
}

// clean trims, drops empty and impossible segments, and orders them.
func clean(in []Segment) []Segment {
	out := make([]Segment, 0, len(in))
	for _, s := range in {
		s.Text = strings.TrimSpace(s.Text)
		if s.Text == "" || math.IsNaN(s.Start) || math.IsInf(s.Start, 0) || s.Start < 0 {
			continue
		}
		if math.IsNaN(s.End) || math.IsInf(s.End, 0) || s.End < s.Start {
			s.End = s.Start
		}
		out = append(out, s)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Start < out[j].Start })
	return out
}

// Explain is one sentence for the learner about a failed transcription. The
// engine's own body is never passed through: it can echo the request, and it
// is written for a developer.
func Explain(err error) string {
	var he *providers.HTTPError
	switch {
	case errors.As(err, &he) && (he.Status == 401 || he.Status == 403):
		return "The speech provider rejected the key. Check it in Settings → Connections."
	case errors.As(err, &he) && he.Status == 413, errors.Is(err, ErrAudioTooLarge):
		return "The speech provider refused the audio as too large."
	case errors.As(err, &he) && he.Status == 429:
		return "The speech provider's limit was reached. Try again later."
	case errors.As(err, &he) && he.Status == 404:
		return "The speech provider does not know that model, or the base URL is wrong."
	case errors.As(err, &he) && he.Status >= 500:
		return "The speech provider is having trouble right now. Try again in a while."
	case errors.As(err, &he):
		return "The speech provider refused the audio."
	case errors.Is(err, ErrNoSpeech):
		return "No speech was heard in the audio."
	case errors.Is(err, ErrBadResponse), errors.Is(err, ErrResponseTooLarge):
		return "The speech provider's answer was not a transcript."
	case errors.Is(err, context.DeadlineExceeded):
		return "The speech provider did not answer in time."
	}
	return "The transcription failed. Try again later."
}
