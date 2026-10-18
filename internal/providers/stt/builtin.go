package stt

import (
	"strings"
	"time"

	"github.com/D0bby999/anytools/internal/providers/builtin"
)

// builtin.go — the server's own Whisper: speaches (faster-whisper behind an
// OpenAI-compatible API) as a compose service, ANYTOOLS_STT_URL. It needs no
// key; it costs the owner CPU, so internal/knowledge meters it per learner.

// DefaultBuiltinModel is the faster-whisper model the compose service loads
// unless ANYTOOLS_STT_MODEL says otherwise: small, int8 on CPU.
const DefaultBuiltinModel = "Systran/faster-whisper-small"

// BuiltinTimeout bounds one window on the built-in engine. A twenty-minute
// window on a small CPU at a few times real time is several minutes; the
// window, not the whole video, is what one call carries.
const BuiltinTimeout = 30 * time.Minute

// initialSpeed is the guess before the first measured job: faster-whisper
// small, int8, on a few CPU cores, hears about four seconds of audio a second.
const initialSpeed = 4.0

// NewBuiltinEngine describes the speaches service at url ("" when the
// operator runs none). It is available only once model is downloaded:
// speaches 0.8 answers GET /v1/models/{id} 404 until `POST /v1/models/{id}`
// has fetched it (deploy/docker-compose.prod.yml's stt-model step).
func NewBuiltinEngine(url, model string) *builtin.Engine {
	if model == "" {
		model = DefaultBuiltinModel
	}
	return builtin.New(url, initialSpeed, BuiltinTimeout).WithReadyPath("/v1/models/" + model)
}

// NewBuiltin is the transcriber for the built-in engine. speaches serves the
// OpenAI routes under /v1.
func NewBuiltin(e *builtin.Engine, model string) *OpenAICompat {
	if model == "" {
		model = DefaultBuiltinModel
	}
	return NewOpenAICompat("", e.URL()+"/v1", model, e.Client())
}

// ModelLabel is a faster-whisper model id as a person reads it:
// "Systran/faster-whisper-small" is "Whisper small",
// "deepdml/faster-whisper-large-v3-turbo-ct2" is "Whisper large-v3-turbo".
func ModelLabel(model string) string {
	m := model
	if i := strings.LastIndex(m, "/"); i >= 0 {
		m = m[i+1:]
	}
	m = strings.TrimSuffix(m, "-ct2")
	if i := strings.Index(m, "whisper-"); i >= 0 {
		return "Whisper " + m[i+len("whisper-"):]
	}
	if m == "" {
		return "Whisper"
	}
	return m
}
