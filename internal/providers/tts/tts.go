// Package tts turns a script into speech (learning-depth phase 10; up-methods
// phase 22). Every engine is one OpenAI-shaped endpoint,
// `POST {base}/audio/speech`: the learner's OpenAI key, their own
// OpenAI-compatible speech server (often their own Kokoro), or the server's
// built-in Kokoro-FastAPI, which needs no key (builtin.go).
//
// Audio comes back as raw 16-bit PCM, not WAV: AnyTools joins the turns
// itself and writes ONE header over the result, so no size a provider
// declares in a header is ever trusted. Every response read is bounded by the
// caller's byte budget, because a connection's base URL is the learner's to
// set and the API is a single replica: one endless body must not take the
// service down.
package tts

import (
	"context"
	"errors"
	"strings"
)

// The audio every synthesizer returns: mono, 16-bit signed little-endian PCM
// at 24 kHz. OpenAI's `pcm` format and Kokoro-FastAPI's are both exactly
// this (OpenAI's text-to-speech guide; Kokoro-FastAPI's StreamingAudioWriter
// is built with sample_rate=24000), so this one rate is the rate each engine
// declares and the rate the WAV header carries.
const (
	SampleRate     = 24000
	BytesPerSecond = SampleRate * 2
)

// ErrTooLong is a response over the caller's budget. It is not retried: the
// same text would produce the same answer.
var ErrTooLong = errors.New("tts: the provider returned more audio than the text can need")

// ErrBadAudio is a response that is not the audio asked for.
var ErrBadAudio = errors.New("tts: the provider's audio could not be read")

// Speaker names one voice in a conversation.
type Speaker struct {
	Name  string
	Voice string
}

// Turn is one speaker's text.
type Turn struct {
	Speaker string
	Text    string
}

// Synthesizer speaks turns. maxPCM bounds the audio, in bytes, that one call
// may return; anything more is ErrTooLong and is never read into memory.
type Synthesizer interface {
	Name() string
	Model() string
	Synthesize(ctx context.Context, turns []Turn, speakers []Speaker, maxPCM int64) ([]byte, error)
	// Ping synthesises one short sentence, for Settings → verify.
	Ping(ctx context.Context) error
}

// Voice families: which list of voice names an engine understands.
const (
	// FamilyKokoro is Kokoro's own voices (af_heart, am_michael, …): the
	// built-in engine, and a learner's own Kokoro server.
	FamilyKokoro = "kokoro"
	// FamilyOpenAI is OpenAI's voices (alloy, nova, onyx, …).
	FamilyOpenAI = "openai"
)

// Family is the voice family a model speaks with. Kokoro-FastAPI serves its
// model as "kokoro" (and maps OpenAI's model names onto it); anything else
// is taken to speak OpenAI's voices, which is what OpenAI-compatible speech
// servers implement.
func Family(model string) string {
	if strings.Contains(strings.ToLower(model), "kokoro") {
		return FamilyKokoro
	}
	return FamilyOpenAI
}
