package tts

import (
	"time"

	"github.com/D0bby999/anytools/internal/providers/builtin"
)

// builtin.go — the server's own voices: Kokoro-FastAPI (hexgrad/kokoro, 82M
// parameters, behind an OpenAI-compatible API) as a compose service,
// ANYTOOLS_TTS_URL. It needs no key; it costs the owner CPU, so the audio
// overview meters it per learner (tts_usage).

// DefaultBuiltinModel is the model name Kokoro-FastAPI serves Kokoro under.
const DefaultBuiltinModel = "kokoro"

// BuiltinProvider is the name the built-in synthesizer reports.
const BuiltinProvider = "builtin"

// BuiltinTimeout bounds one call to the built-in engine: one turn of at most
// 90 words, which Kokoro speaks on a CPU in seconds. A busy server queues.
const BuiltinTimeout = 5 * time.Minute

// initialSpeed is the guess before the first measured job, in seconds of
// speech made per wall second: Kokoro on a few CPU cores is faster than real
// time; two is a cautious start.
const initialSpeed = 2.0

// NewBuiltinEngine describes the Kokoro-FastAPI service at url ("" when the
// operator runs none). Kokoro-FastAPI loads and warms its model before it
// serves anything, so /health answering means it can speak; the model route
// is checked as well, so a service that serves some other model is not
// offered.
func NewBuiltinEngine(url string) *builtin.Engine {
	return builtin.New(url, initialSpeed, BuiltinTimeout).WithReadyPath("/v1/models/" + DefaultBuiltinModel)
}

// NewBuiltin is the synthesizer for the built-in engine. Kokoro-FastAPI
// serves the OpenAI routes under /v1.
func NewBuiltin(e *builtin.Engine) *OpenAICompat {
	return NewOpenAICompat(BuiltinProvider, "", e.URL()+"/v1", DefaultBuiltinModel, e.Client())
}
