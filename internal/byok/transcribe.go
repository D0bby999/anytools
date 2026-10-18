package byok

import (
	"context"
	"io"

	"github.com/google/uuid"

	mediafile "github.com/D0bby999/anytools/internal/connectors/media"
	"github.com/D0bby999/anytools/internal/connectors/youtube"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/providers/stt"
	"github.com/D0bby999/anytools/internal/store"
)

// TranscriberFor resolves the learner's video transcribers by URL: the Gemini
// API-key connections on their `stt` route, then those on their `parse`
// route, in route order (learning-depth phase 4; up-methods phase 21).
//
// Gemini, because only Gemini's native generateContent accepts a public
// YouTube URL as video input, and the OpenAI-compatible shim cannot pass one.
// The stt route first, because that is where a learner now says how they
// want speech transcribed. The parse route still counts, so a learner who set
// up a Gemini key for documents before phase 21 transcribes exactly as they
// did. Other entries on either route are passed over silently: they hear
// audio (STTFor) rather than reading a URL. The Gemini subscription lane is
// out of scope; it rides the Code Assist API, which was not checked for URL
// input.
//
// A chain like the others, so a 429 benches the key for the parse route too
// (the same connection, the same quota) and the next Gemini key is tried.
func (s *Service) TranscriberFor(ctx context.Context, userID uuid.UUID) (*Chain[youtube.Transcriber], error) {
	return geminiChain(ctx, s, userID, string(FunctionParse)+":transcribe",
		func(secret, base, model string) youtube.Transcriber { return youtube.NewGemini(secret, base, model) })
}

// GeminiFilesFor is TranscriberFor's keys, each as a Gemini Files API client
// (up-methods phase 15): an uploaded recording has no URL to read, so it is
// uploaded under the key that hears it. The same connections, in the same
// order, so a key benched for one is benched for the other.
func (s *Service) GeminiFilesFor(ctx context.Context, userID uuid.UUID) (*Chain[*mediafile.GeminiFiles], error) {
	return geminiChain(ctx, s, userID, string(FunctionParse)+":transcribe",
		func(secret, base, model string) *mediafile.GeminiFiles {
			return mediafile.NewGeminiFiles(secret, base, model)
		})
}

func geminiChain[T any](ctx context.Context, s *Service, userID uuid.UUID, function string,
	build func(secret, base, model string) T) (*Chain[T], error) {
	var entries []Entry[T]
	seen := map[uuid.UUID]bool{}
	for _, fn := range []Function{FunctionSTT, FunctionParse} {
		rows, err := s.routes.ChainFor(ctx, userID, string(fn))
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			c := row.Connection
			if c.Provider != providers.ProviderGemini || c.Kind != store.KindAPIKey || seen[c.ID] {
				continue
			}
			seen[c.ID] = true
			model := row.Model
			if model == "" {
				model = defaultParseModel(c.Provider)
			}
			entries = append(entries, Entry[T]{
				Client:       build(c.Secret, c.APIBase, model),
				ConnectionID: c.ID,
				Provider:     c.Provider,
				Name:         c.Name,
				Model:        model,
				Position:     len(entries),
				Settings:     c.Settings,
			})
		}
	}
	return &Chain[T]{
		Function: function,
		entries:  entries,
		userID:   userID,
		store:    s.conns,
		now:      s.now,
		sleep:    s.sleep,
	}, nil
}

// STTFor resolves the learner's audio transcribers: the OpenAI, Groq and
// OpenAI-compatible connections on their `stt` route, in route order. Gemini
// entries are left to TranscriberFor.
//
// only, when not uuid.Nil, narrows the chain to that one connection: the
// learner chose "your Groq key" on the page after seeing its estimate, and a
// fallback to a different provider would spend a different account's money
// without asking. A connection that is not on the caller's stt route is not in
// the result, so a foreign or a deleted id resolves to an empty chain, the
// same as a nonexistent one.
func (s *Service) STTFor(ctx context.Context, userID, only uuid.UUID) (*Chain[stt.Transcriber], error) {
	chain, err := buildChain(ctx, s, userID, FunctionSTT, s.sttClient)
	if err != nil {
		return nil, err
	}
	kept := chain.entries[:0]
	for _, e := range chain.entries {
		if e.Provider == providers.ProviderGemini {
			continue
		}
		if only != uuid.Nil && e.ConnectionID != only {
			continue
		}
		if e.Model == "" {
			e.Model = defaultSTTModel(e.Provider)
		}
		kept = append(kept, e)
	}
	chain.entries = kept
	chain.Function = string(FunctionSTT)
	return chain, nil
}

// sttClient builds a transcriber for one routed connection. A Gemini entry
// gets none here (it reads URLs, through TranscriberFor); buildChain logs and
// drops it, and STTFor never asks.
func (s *Service) sttClient(_ context.Context, _ uuid.UUID, e store.ChainEntry) (stt.Transcriber, error) {
	c := e.Connection
	model := e.Model
	if model == "" {
		model = defaultSTTModel(c.Provider)
	}
	switch c.Provider {
	case providers.ProviderOpenAI:
		base := normalizeBaseFor(c.Provider, c.APIBase)
		if base == "" {
			base = stt.DefaultOpenAIBase
		}
		return stt.NewOpenAICompat(c.Secret, base, model, nil), nil
	case providers.ProviderOpenAICompat:
		// The stored base passed the BYOK endpoint guard when the connection
		// was saved (security.ValidateBYOKEndpoint), and the egress client
		// re-checks every address it dials.
		return stt.NewOpenAICompat(c.Secret, normalizeBaseFor(c.Provider, c.APIBase), model, nil), nil
	case providers.ProviderGroq:
		return stt.NewOpenAICompat(c.Secret, presetBase(c.Provider, c.APIBase), model, nil), nil
	case providers.ProviderGemini:
		return geminiSTTMarker{}, nil
	}
	return nil, invalid("%s cannot transcribe speech", c.Provider)
}

// geminiSTTMarker stands in for a Gemini entry on the stt chain, so the chain
// builder keeps it (STTFor then filters it out by provider). It never runs.
type geminiSTTMarker struct{}

func (geminiSTTMarker) Transcribe(context.Context, io.Reader, string, string) (*stt.Segments, error) {
	return nil, errGeminiHearsNoAudio
}

var errGeminiHearsNoAudio = invalid("a Gemini key reads a video's URL; it is not sent audio")
