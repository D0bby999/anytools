package byok

import (
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/rag/embed"
	"github.com/D0bby999/anytools/internal/rag/parse"
	"github.com/D0bby999/anytools/internal/store"
)

// models.go — the default model id per provider per function, and the ONE place
// a model id is written down.
//
// Dated, deliberately. Model ids move faster than this codebase will: every id
// below was current on 2026-09-16 and several will be gone within months. The
// rule that keeps that from becoming a scatter of stale literals is that a
// model id appears here or in a user's own route entry, never inline in a
// client. When one dies, this file is the diff.
//
// These are only DEFAULTS. A route entry's `model` always wins, and the models
// endpoint offers the live list from the user's own key rather than this list,
// precisely because this list is the part that goes stale.
const (
	// Chat. gemini-2.5-flash is what the spike streamed through Google's
	// OpenAI shim at 1.3-1.5 s to first chunk; the OpenRouter and Anthropic
	// ids are their vendors' current mid-tier.
	DefaultGeminiChatModel     = "gemini-2.5-flash"
	DefaultOpenAIChatModel     = "gpt-4o-mini"
	DefaultAnthropicChatModel  = "claude-sonnet-4-5-20250929"
	DefaultOpenRouterChatModel = "z-ai/glm-5.2:free"
)

// One Gemini connection, three wire formats — and therefore one canonical base.
//
// Google serves three different things under one host:
//
//	/v1beta/models/{model}:generateContent        parse
//	/v1beta/models/{model}:batchEmbedContents     embed
//	/v1beta/openai/chat/completions               chat (the OpenAI shim)
//
// A connection has ONE api_base column, so no single stored value can be handed
// verbatim to all three. The contract is therefore: **the column stores the
// NATIVE base** (ending /v1beta), parse and embed use it as-is, and the chat
// client appends the shim suffix.
//
// Not hypothetical tidying. Before this, a user who pasted the documented shim
// base got ".../v1beta/openai/v1beta" and all three lanes 404'd, and a user who
// pasted the bare host got a chat client aimed at "/v1beta/chat/completions",
// which Google does not serve.
const (
	// GeminiNativeBase is what a Gemini connection's api_base normalises to.
	GeminiNativeBase = "https://generativelanguage.googleapis.com/v1beta"
	// GeminiShimSuffix turns the native base into the chat base.
	GeminiShimSuffix = "/openai"
)

// GeminiOpenAIShimBase is Google's OpenAI-compatibility endpoint.
//
// Gemini API keys ride the shared OpenAI transport through this base rather
// than getting their own chat client — the spike measured that lane working end
// to end. The shim is NOT a tolerant OpenAI clone: it rejects any field it does
// not know with a 400, for every call, even when the value is the neutral
// default. providers.applyGoogleShimCompat is what strips those; pointing a
// Gemini key at any other base would lose that protection.
const GeminiOpenAIShimBase = GeminiNativeBase + GeminiShimSuffix

// defaultChatModel returns the chat model for a provider when the route entry
// names none.
func defaultChatModel(provider string) string {
	switch provider {
	case providers.ProviderGemini:
		return DefaultGeminiChatModel
	case providers.ProviderOpenAI:
		return DefaultOpenAIChatModel
	case providers.ProviderAnthropic:
		return DefaultAnthropicChatModel
	case providers.ProviderOpenRouter:
		return DefaultOpenRouterChatModel
	case providers.ProviderChatGPTRelay:
		return providers.DefaultCodexModel
	case providers.ProviderGeminiSub:
		return providers.DefaultCodeAssistModel
	case providers.ProviderGitHubCopilot:
		return providers.DefaultCopilotModel
	case providers.ProviderClaudeSub:
		return DefaultAnthropicChatModel
	default:
		if p, ok := presetOf(provider); ok {
			return p.ChatModel
		}
		// openai_compat: the user pasted a base URL we know nothing about, so
		// there is no honest default. The route entry must name a model, and
		// the routes editor requires one for this provider.
		return ""
	}
}

// defaultParseModel returns the document-parsing model for a provider.
//
// Only three providers can parse a PDF at all. The spike measured Gemini at
// 2/2 on tables and 10/10 on page attribution; OpenAI and Anthropic could not
// be scored because both accounts were out of credit, so their place in the
// fallback order is designed rather than measured (reports/spike-parse.md).
func defaultParseModel(provider string) string {
	switch provider {
	case providers.ProviderGemini:
		return parse.DefaultGeminiParseModel
	case providers.ProviderOpenAI:
		return parse.DefaultOpenAIParseModel
	case providers.ProviderAnthropic:
		return parse.DefaultAnthropicParseModel
	default:
		return ""
	}
}

// defaultEmbedModel returns the embedding model for a provider.
func defaultEmbedModel(provider string) string {
	switch provider {
	case providers.ProviderGemini:
		return embed.DefaultGeminiEmbedModel
	case providers.ProviderOpenAI:
		return embed.DefaultOpenAIEmbedModel
	default:
		return presets[provider].EmbedModel
	}
}

// ProviderSupports reports whether a provider can serve a function's kind at
// all.
//
// This is what keeps the routes editor from offering an impossible pairing —
// an Anthropic key on the embed function, say, which Anthropic has no endpoint
// for. Catching it at write time turns "my quiz does nothing" into "Anthropic
// cannot embed", which is a sentence the user can act on.
func ProviderSupports(provider string, f Function) bool {
	switch KindOf(f) {
	case KindParse:
		return defaultParseModel(provider) != ""
	case KindEmbed:
		// A custom endpoint has no default, but most OpenAI-compatible
		// servers (Ollama, LM Studio, vLLM, TEI) answer /embeddings: a route
		// on one names its model, and verify refuses a width AnyLearn cannot
		// store (embed.SupportedDims).
		return defaultEmbedModel(provider) != "" || provider == providers.ProviderOpenAICompat
	case KindTTS:
		// An explicit allow-list. Falling through to the default would offer
		// Anthropic, every OpenAI-compatible preset and the subscription
		// lanes for speech (learning-depth red team AS-16).
		return ttsProviders[provider]
	case KindSTT:
		// An allow-list too: Anthropic has no speech endpoint, and most
		// OpenAI-compatible presets serve chat only.
		return sttProviders[provider]
	default:
		return true
	}
}

// ConnectionSupports is ProviderSupports for one connection: a subscription
// lane shares its provider's name but not its endpoints, and speech, either
// way, is served by an API key only.
func ConnectionSupports(provider, kind string, f Function) bool {
	if (KindOf(f) == KindTTS || KindOf(f) == KindSTT) && kind != store.KindAPIKey {
		return false
	}
	return ProviderSupports(provider, f)
}

// Text to speech (up-methods phase 22). Gemini no longer speaks: the owner
// replaced it with Kokoro on 2026-10-02. A learner's own speech is an OpenAI
// key, or their own OpenAI-compatible speech server (their own Kokoro, say),
// whose base URL passed the BYOK endpoint guard when it was saved.

// DefaultOpenAITTSModel is OpenAI's speech model billed per character, which
// is the cost the "Speak it" step shows. tts-1-hd and gpt-4o-mini-tts may be
// routed by name.
const DefaultOpenAITTSModel = "tts-1"

// ttsProviders may serve the tts function.
var ttsProviders = map[string]bool{
	providers.ProviderOpenAI:       true,
	providers.ProviderOpenAICompat: true,
}

// defaultTTSModel is a provider's speech model, or "" where there is no
// honest default (an OpenAI-compatible server speaks whatever its owner
// loaded, "kokoro" or "tts-1"; the route entry names it).
func defaultTTSModel(provider string) string {
	if provider == providers.ProviderOpenAI {
		return DefaultOpenAITTSModel
	}
	return ""
}

// Speech to text (up-methods phase 21). Dated 2026-10-02, from OpenAI's
// speech-to-text guide and Groq's model list.
const (
	// DefaultOpenAISTTModel is the one OpenAI model with segment times;
	// gpt-4o-transcribe and gpt-4o-mini-transcribe answer text only.
	DefaultOpenAISTTModel = "whisper-1"
	// DefaultGroqSTTModel is Groq's faster Whisper; whisper-large-v3 is the
	// more accurate one.
	DefaultGroqSTTModel = "whisper-large-v3-turbo"
)

// sttProviders may serve the stt function: OpenAI, Groq, a learner's own
// OpenAI-compatible Whisper server, and Gemini, which reads a public video's
// URL instead of hearing audio.
var sttProviders = map[string]bool{
	providers.ProviderOpenAI:       true,
	providers.ProviderGroq:         true,
	providers.ProviderOpenAICompat: true,
	providers.ProviderGemini:       true,
}

// defaultSTTModel is a provider's transcription model, or "" where there is
// no honest default (an OpenAI-compatible server runs whatever its owner
// loaded; the route entry names it).
func defaultSTTModel(provider string) string {
	switch provider {
	case providers.ProviderOpenAI:
		return DefaultOpenAISTTModel
	case providers.ProviderGroq:
		return DefaultGroqSTTModel
	case providers.ProviderGemini:
		// The model that reads the video: the parse model, as before phase 21.
		return parse.DefaultGeminiParseModel
	}
	return ""
}
