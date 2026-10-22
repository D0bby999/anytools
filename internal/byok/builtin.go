package byok

import (
	"context"

	"github.com/google/uuid"
)

// builtin.go — the server's own engines on the readiness matrix (up-methods
// phase 21: Whisper for stt; phase 22: Kokoro for tts).
//
// A built-in engine is not a connection: it has no key, no chain position and
// no cooldown, and nobody routes it. But a learner reading "No stt route"
// while the server would transcribe for them for free is being told
// something untrue, so the function's row says the engine is there. One
// registration per function, generic over what the engine does.

// BuiltinEngine is one server-run engine as readiness sees it.
type BuiltinEngine struct {
	// Label is the row's sentence: "Built-in transcription (free, slower)".
	Label string
	// Available reports whether the engine answers right now.
	Available func(ctx context.Context) bool
}

// BuiltinProvider is the provider name a built-in engine's readiness entry
// carries, so the UI can tell it from a connection.
const BuiltinProvider = "builtin"

// UseBuiltin registers fn's built-in engine. Called at wiring time; a server
// that runs none never calls it, and the matrix is what it was.
func (s *Service) UseBuiltin(fn Function, e BuiltinEngine) {
	if s.builtins == nil {
		s.builtins = map[Function]BuiltinEngine{}
	}
	s.builtins[fn] = e
}

// optionalFunctions run without a route: parse reads text files and text-layer
// PDFs on the server, speech falls back to the browser's voices, and
// transcription to a subtitle file, a paste, or the built-in engine.
var optionalFunctions = []Function{FunctionParse, FunctionTTS, FunctionSTT}

// withBuiltin adds fn's built-in engine to its row when it answers. With no
// route the engine alone makes the function ready.
func (s *Service) withBuiltin(ctx context.Context, row FunctionReadiness) FunctionReadiness {
	e, ok := s.builtins[row.Function]
	if !ok || e.Available == nil || !e.Available(ctx) {
		return row
	}
	row.Entries = append(row.Entries, ReadinessEntry{
		ConnectionID: uuid.Nil, Name: e.Label, Provider: BuiltinProvider, Status: StatusGreen,
	})
	switch {
	case len(row.Entries) == 1:
		row.Status, row.Reason = StatusGreen, ""
	case row.Status == StatusBlocked:
		// Every routed key is unusable, but the function still runs.
		row.Status = StatusWarn
	}
	return row
}
