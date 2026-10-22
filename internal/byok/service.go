package byok

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/connectors/feeds"
	"github.com/D0bby999/anytools/internal/connectors/github"
	"github.com/D0bby999/anytools/internal/connectors/zotero"
	"github.com/D0bby999/anytools/internal/oauth"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/providers/tts"
	"github.com/D0bby999/anytools/internal/rag/embed"
	"github.com/D0bby999/anytools/internal/rag/parse"
	"github.com/D0bby999/anytools/internal/rag/search"
	"github.com/D0bby999/anytools/internal/store"
)

// Service is the one object the rest of AnyTools asks for an AI client.
//
// Its whole public surface is four resolvers — ChatFor, ParserFor, EmbedderFor,
// SearchFor — plus the Settings operations. Phases 5 to 10 call the resolvers
// and never touch a connection row, a key or a provider constructor, which is
// what keeps "which credential, whose, and what happens when it fails" in one
// place instead of in nine features.
type Service struct {
	conns  store.ProviderConnectionStore
	routes store.FunctionRouteStore
	search store.SearchConnectionStore
	tokens *oauth.Service
	// keylessSearch: research has a keyless web fallback (readiness wording).
	keylessSearch bool
	// github verifies a GitHub token; nil builds the production client.
	github *github.Client
	// zotero verifies a Zotero key; nil builds the production client.
	zotero *zotero.Client
	// youtubeData verifies a YouTube Data API key; nil builds the production
	// client.
	youtubeData *feeds.Data

	now   func() time.Time
	sleep func(time.Duration)
	// lanesEnabled is injectable so a test can prove BOTH states without
	// mutating process environment, which would race with every parallel test.
	lanesEnabled func() bool
	// connectors are the non-AI readiness reporters registered at wiring time
	// (phase 13). Empty by default; see connectors.go.
	connectors []ConnectorReporter
	// builtins are the server's own engines by function (up-methods phase
	// 21), registered at wiring time; see builtin.go.
	builtins map[Function]BuiltinEngine
}

// NewService wires the BYOK service.
func NewService(conns store.ProviderConnectionStore, routes store.FunctionRouteStore, searchStore store.SearchConnectionStore, tokens *oauth.Service) *Service {
	return &Service{
		conns:        conns,
		routes:       routes,
		search:       searchStore,
		tokens:       tokens,
		now:          time.Now,
		lanesEnabled: oauth.ExperimentalLanesEnabled,
	}
}

// LanesEnabled reports whether the experimental subscription lanes are on.
func (s *Service) LanesEnabled() bool { return s.lanesEnabled() }

// ChatFor resolves the user's chain for a chat-shaped function.
//
// fn is a Function rather than a fixed "chat" because nearly every capability
// in the product is a chat call with a different prompt, and the user routes
// them independently: a cheap local model for rerank, their best model for
// solve. Passing the function through is what makes that possible.
func (s *Service) ChatFor(ctx context.Context, userID uuid.UUID, fn Function) (*Chain[providers.Provider], error) {
	if KindOf(fn) != KindChat {
		return nil, fmt.Errorf("byok: %s is not a chat function — use %s", fn, resolverNameFor(fn))
	}
	return buildChain(ctx, s, userID, fn, s.chatClient)
}

// ParserFor resolves the user's document-parsing chain.
func (s *Service) ParserFor(ctx context.Context, userID uuid.UUID) (*Chain[parse.DocumentParser], error) {
	return buildChain(ctx, s, userID, FunctionParse, s.parserClient)
}

// EmbedderFor resolves the user's embedding chain.
func (s *Service) EmbedderFor(ctx context.Context, userID uuid.UUID) (*Chain[embed.Embedder], error) {
	return buildChain(ctx, s, userID, FunctionEmbed, s.embedClient)
}

// TTSFor resolves the user's speech chain (learning depth, phase 10;
// up-methods phase 22). A user with no `tts` route gets ErrNoRoute from the
// chain, and the audio overview offers the built-in voices or the browser.
//
// only, when not uuid.Nil, narrows the chain to that one connection: the
// learner chose "your OpenAI key" after seeing its cost, and a fallback to a
// different key would spend a different account's money without asking. A
// connection that is not on the caller's tts route is not in the result, so a
// foreign or deleted id resolves to an empty chain, like a nonexistent one.
func (s *Service) TTSFor(ctx context.Context, userID, only uuid.UUID) (*Chain[tts.Synthesizer], error) {
	chain, err := buildChain(ctx, s, userID, FunctionTTS, s.ttsClient)
	if err != nil || only == uuid.Nil {
		return chain, err
	}
	kept := chain.entries[:0]
	for _, e := range chain.entries {
		if e.ConnectionID == only {
			kept = append(kept, e)
		}
	}
	chain.entries = kept
	return chain, nil
}

// SearchFor resolves the user's web-search keys.
//
// It returns a chain like the others so a caller's code shape does not change
// between "has a search key" and "does not", but it reads search_connections,
// not function_routes: a search key has no model and no chain position, and
// overloading the research route with both was red-team RT-13's finding.
//
// A user with no key gets an EMPTY chain and ErrNoRoute from Do — which the
// research feature turns into "runs KB-only" rather than an error, because with
// no platform key that is the honest, working behaviour.
func (s *Service) SearchFor(ctx context.Context, userID uuid.UUID) (*Chain[search.Client], error) {
	rows, err := s.search.SearchChain(ctx, userID)
	if err != nil {
		return nil, err
	}
	entries := make([]Entry[search.Client], 0, len(rows))
	for i, row := range rows {
		if !isWebSearch(row.Provider) {
			continue // an OpenAlex key searches papers, not the web (PaperKeyFor)
		}
		client, err := search.New(row.Provider, row.Secret)
		if err != nil {
			continue
		}
		entries = append(entries, Entry[search.Client]{
			Client:       client,
			ConnectionID: row.ID,
			Provider:     row.Provider,
			Name:         row.Provider,
			Position:     i,
		})
	}
	// Search keys live in their own table and carry no settings blob, so a
	// failure is not persisted as a cooldown: a no-op writer keeps the chain
	// generic without inventing a column to write into.
	return &Chain[search.Client]{
		Function: string(FunctionResearch) + ":search",
		entries:  entries,
		userID:   userID,
		store:    noopSettingsWriter{},
		now:      s.now,
		sleep:    s.sleep,
	}, nil
}

func resolverNameFor(fn Function) string {
	switch KindOf(fn) {
	case KindParse:
		return "ParserFor"
	case KindEmbed:
		return "EmbedderFor"
	case KindTTS:
		return "TTSFor"
	case KindSTT:
		return "STTFor"
	default:
		return "ChatFor"
	}
}

// buildChain is the shared resolution path: read the routed connections, build
// one client per entry, drop the ones that cannot be built.
//
// A generic function rather than a method because Go does not allow a method to
// introduce its own type parameter.
func buildChain[T any](ctx context.Context, s *Service, userID uuid.UUID, fn Function,
	build func(context.Context, uuid.UUID, store.ChainEntry) (T, error)) (*Chain[T], error) {

	rows, err := s.routes.ChainFor(ctx, userID, string(fn))
	if err != nil {
		return nil, err
	}

	entries := make([]Entry[T], 0, len(rows))
	unbuildable := 0
	for _, row := range rows {
		if isSubscriptionKind(row.Connection.Kind) && !s.lanesEnabled() {
			// A route built while the flag was on must not serve while it is
			// off. Skipping rather than erroring keeps the rest of the chain
			// working, which is what "off by default" should feel like.
			unbuildable++
			continue
		}
		client, err := build(ctx, userID, row)
		if err != nil {
			// A connection we cannot build a client for is not a failure of the
			// request — it is a broken route entry, and the next entry may be
			// fine. But dropping it SILENTLY is how a chain of two quietly
			// becomes a chain of one: loud here, and mirrored in readiness by
			// the ProviderSupports check.
			slog.Warn("byok: route entry skipped — no client could be built",
				"function", fn, "connection", row.Connection.ID,
				"provider", row.Connection.Provider, "error", err)
			unbuildable++
			continue
		}
		entries = append(entries, Entry[T]{
			Client:       client,
			ConnectionID: row.Connection.ID,
			Provider:     row.Connection.Provider,
			Name:         row.Connection.Name,
			Model:        row.Model,
			Position:     row.Position,
			Settings:     row.Connection.Settings,
		})
	}

	return &Chain[T]{
		Function:    string(fn),
		entries:     entries,
		unbuildable: unbuildable,
		userID:      userID,
		store:       s.conns,
		now:         s.now,
		sleep:       s.sleep,
	}, nil
}

// isSubscriptionKind: every kind but a pasted key is a subscription lane, and
// all of them sit behind the experimental flag.
func isSubscriptionKind(kind string) bool {
	return kind != store.KindAPIKey
}

// chatClient builds a providers.Provider for one routed connection.
func (s *Service) chatClient(ctx context.Context, userID uuid.UUID, e store.ChainEntry) (providers.Provider, error) {
	c := e.Connection
	model := e.Model
	if model == "" {
		model = defaultChatModel(c.Provider)
	}

	switch c.Provider {
	case providers.ProviderGemini:
		// Gemini API keys ride the shared OpenAI transport through Google's
		// compatibility shim. The provider NAME must stay "gemini_native":
		// providers.applyGoogleShimCompat keys on it to strip the fields the
		// shim 400s on, and every agent turn sets one of them.
		// The column holds the NATIVE base; chat is the one lane that needs the
		// shim suffix on top of it — models.go states the contract.
		base := normalizeBaseFor(providers.ProviderGemini, c.APIBase)
		if base == "" {
			base = GeminiNativeBase
		}
		return providers.NewOpenAIProvider("gemini_native", c.Secret, base+GeminiShimSuffix, model), nil

	case providers.ProviderOpenAI, providers.ProviderOpenAICompat:
		return providers.NewOpenAIProvider(c.Provider, c.Secret,
			normalizeBaseFor(c.Provider, c.APIBase), model), nil

	case providers.ProviderOpenRouter:
		base := normalizeBaseFor(c.Provider, c.APIBase)
		if base == "" {
			base = "https://openrouter.ai/api/v1"
		}
		return providers.NewOpenAIProvider("openrouter", c.Secret, base, model), nil

	case providers.ProviderAnthropic:
		opts := []providers.AnthropicOption{providers.WithAnthropicModel(model)}
		if base := normalizeBaseFor(c.Provider, c.APIBase); base != "" {
			opts = append(opts, providers.WithAnthropicBaseURL(base))
		}
		return providers.NewAnthropicProvider(c.Secret, opts...), nil

	case providers.ProviderChatGPTRelay:
		if s.tokens == nil {
			return nil, fmt.Errorf("byok: subscription lanes are not wired")
		}
		accountID := ""
		if c.Settings.OAuth != nil {
			accountID = c.Settings.OAuth.AccountID
		}
		return providers.NewCodexProvider(s.tokens.TokenSourceFor(ctx, userID, c.ID), accountID, model), nil

	case providers.ProviderGeminiSub:
		if s.tokens == nil {
			return nil, fmt.Errorf("byok: subscription lanes are not wired")
		}
		projectID := ""
		if c.Settings.OAuth != nil {
			projectID = c.Settings.OAuth.ProjectID
		}
		return providers.NewGeminiCodeAssistProvider(s.tokens.TokenSourceFor(ctx, userID, c.ID), projectID, model), nil

	case providers.ProviderGitHubCopilot:
		if s.tokens == nil {
			return nil, fmt.Errorf("byok: subscription lanes are not wired")
		}
		return providers.NewCopilotProvider(s.tokens.TokenSourceFor(ctx, userID, c.ID), model), nil

	case providers.ProviderClaudeSub:
		if s.tokens == nil {
			return nil, fmt.Errorf("byok: subscription lanes are not wired")
		}
		// Fetched at build time: a chain is built per request, and the token
		// service refreshes five minutes before expiry, so the token outlives
		// any single answer.
		token, err := s.tokens.TokenSourceFor(ctx, userID, c.ID).Token()
		if err != nil {
			return nil, err
		}
		var deviceID, accountUUID string
		if c.Settings.OAuth != nil {
			deviceID, accountUUID = c.Settings.OAuth.DeviceID, c.Settings.OAuth.AccountID
		}
		return providers.NewAnthropicProvider(token, providers.WithAnthropicModel(model),
			providers.WithAnthropicOAuth(deviceID, accountUUID)), nil
	}
	if _, ok := presetOf(c.Provider); ok {
		return providers.NewOpenAIProvider(c.Provider, c.Secret, presetBase(c.Provider, c.APIBase), model), nil
	}
	return nil, fmt.Errorf("byok: provider %q has no chat client", c.Provider)
}

// parserClient builds a parse.DocumentParser for one routed connection.
func (s *Service) parserClient(_ context.Context, _ uuid.UUID, e store.ChainEntry) (parse.DocumentParser, error) {
	c := e.Connection
	model := e.Model
	if model == "" {
		model = defaultParseModel(c.Provider)
	}
	switch c.Provider {
	case providers.ProviderGemini:
		return parse.NewGeminiParser(c.Secret, c.APIBase, model), nil
	case providers.ProviderOpenAI:
		return parse.NewOpenAIParser(c.Secret, c.APIBase, model), nil
	case providers.ProviderAnthropic:
		return parse.NewAnthropicParser(c.Secret, c.APIBase, model), nil
	}
	// Reaching here means a route was written for a provider with no parsing
	// endpoint. ReplaceRoute refuses those, so this is the belt to that braces.
	return nil, fmt.Errorf("byok: provider %q cannot parse documents", c.Provider)
}

// ttsClient builds a tts.Synthesizer for one routed connection: an OpenAI key
// or an OpenAI-compatible speech server, both POST {base}/audio/speech.
func (s *Service) ttsClient(_ context.Context, _ uuid.UUID, e store.ChainEntry) (tts.Synthesizer, error) {
	c := e.Connection
	if !ConnectionSupports(c.Provider, c.Kind, FunctionTTS) {
		return nil, fmt.Errorf("byok: %q cannot speak", c.Provider)
	}
	model := e.Model
	if model == "" {
		model = defaultTTSModel(c.Provider)
	}
	switch c.Provider {
	case providers.ProviderOpenAI:
		base := normalizeBaseFor(c.Provider, c.APIBase)
		if base == "" {
			base = tts.DefaultOpenAIBase
		}
		return tts.NewOpenAICompat(c.Provider, c.Secret, base, model, nil), nil
	case providers.ProviderOpenAICompat:
		// The stored base passed the BYOK endpoint guard when the connection
		// was saved (security.ValidateBYOKEndpoint), and the egress client
		// re-checks every address it dials.
		return tts.NewOpenAICompat(c.Provider, c.Secret, normalizeBaseFor(c.Provider, c.APIBase), model, nil), nil
	}
	return nil, fmt.Errorf("byok: %q cannot speak", c.Provider)
}

// embedClient builds an embed.Embedder for one routed connection.
func (s *Service) embedClient(_ context.Context, _ uuid.UUID, e store.ChainEntry) (embed.Embedder, error) {
	c := e.Connection
	model := e.Model
	if model == "" {
		model = defaultEmbedModel(c.Provider)
	}
	// The pinned width comes from the route entry, then from whatever the last
	// verify measured. Zero is a legitimate "not yet known" and makes the first
	// call learn the model's native width instead of imposing one.
	dims := e.Dims
	if dims == 0 {
		dims = c.Settings.Dims
	}
	switch c.Provider {
	case providers.ProviderGemini:
		return embed.NewGeminiEmbedder(c.Secret, c.APIBase, model, dims), nil
	case providers.ProviderOpenAI:
		return embed.NewOpenAIEmbedder(c.Secret, c.APIBase, model, dims), nil
	case providers.ProviderOpenAICompat:
		// No `dimensions` field: an unknown server may reject it or ignore
		// it, and the width is the model's own, learned on verify. The base
		// passed the BYOK endpoint guard when it was saved.
		return embed.NewOpenAIEmbedder(c.Secret, c.APIBase, model, dims).WithoutDimensionsField(), nil
	}
	if p, ok := presetOf(c.Provider); ok && p.EmbedModel != "" {
		e := embed.NewOpenAIEmbedder(c.Secret, presetBase(c.Provider, c.APIBase), model, dims)
		if !p.EmbedSendsDims {
			e = e.WithoutDimensionsField()
		}
		return e, nil
	}
	return nil, fmt.Errorf("byok: provider %q cannot embed", c.Provider)
}

// noopSettingsWriter absorbs the chain's cooldown writes for the search chain,
// whose rows have no settings column.
type noopSettingsWriter struct{}

func (noopSettingsWriter) MergeConnectionSettings(context.Context, uuid.UUID, uuid.UUID, json.RawMessage) error {
	return nil
}

// SetSleepForTest replaces the chain's transient-blip pause.
//
// Exported for tests only: the grace itself is behaviour worth asserting, but
// sleeping two real seconds per assertion is not, and `go test -race` runs this
// package's chain tests several times over.
func (s *Service) SetSleepForTest(fn func(time.Duration)) { s.sleep = fn }

// SetNowForTest replaces the clock used for cooldown arithmetic.
func (s *Service) SetNowForTest(fn func() time.Time) { s.now = fn }

// SetLanesEnabledForTest overrides the experimental-lane gate without touching
// process environment, which would race with every parallel test.
func (s *Service) SetLanesEnabledForTest(fn func() bool) { s.lanesEnabled = fn }

// NormalizeBaseForTest exposes the base-URL canonicalisation so the Gemini
// contract — one column, three wire formats — can be pinned by a test without
// standing up a database and a connection first.
func NormalizeBaseForTest(provider, raw string) string { return normalizeBaseFor(provider, raw) }
