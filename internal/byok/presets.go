package byok

import "github.com/D0bby999/anytools/internal/providers"

// presets.go — API-key providers that speak the OpenAI wire format at a known
// address, so connecting one is "pick it, paste a key" rather than typing a
// base URL into openai_compat.
//
// One table, because everything a preset differs by is data: where it lives,
// which model to default to, and whether it can embed. A preset is served by
// the same providers.OpenAIProvider every OpenAI-shaped lane uses; its name is
// the preset id, which is what the provider's compat hooks key on
// (providers.applyStrictSchemaCompat for Mistral).
//
// Model ids are defaults dated 2026-09-26 and follow models.go's rule: a model
// id is written here or in a user's route entry, never inline in a client. The
// chat ids were taken from postclaw's provider defaults where it had one
// (Groq's Llama ids were shut down in 2026 in favour of gpt-oss; DeepSeek's
// `deepseek-chat` is its stable alias).

// preset describes one OpenAI-compatible provider.
type preset struct {
	// Base is the default API base, INCLUDING its version segment — Z.AI's is
	// /v4 and DashScope's is /compatible-mode/v1, so no single "append /v1"
	// rule covers them.
	Base      string
	ChatModel string
	// EmbedModel is empty when the provider has no embeddings endpoint.
	EmbedModel string
	// EmbedSendsDims says whether the embeddings endpoint accepts OpenAI's
	// `dimensions` field. Mistral's does not, and rejects the request.
	EmbedSendsDims bool
}

var presets = map[string]preset{
	providers.ProviderDeepSeek: {Base: "https://api.deepseek.com/v1", ChatModel: "deepseek-chat"},
	providers.ProviderXAI:      {Base: "https://api.x.ai/v1", ChatModel: "grok-4"},
	// mistral-embed is 1024 wide — one of the widths the vector column takes.
	providers.ProviderMistral: {Base: "https://api.mistral.ai/v1", ChatModel: "mistral-medium-latest",
		EmbedModel: "mistral-embed"},
	providers.ProviderGroq: {Base: "https://api.groq.com/openai/v1", ChatModel: "openai/gpt-oss-120b"},
	// Alibaba's international endpoint. text-embedding-v4 defaults to 1024 and
	// honours `dimensions`.
	providers.ProviderQwen: {Base: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", ChatModel: "qwen3-max",
		EmbedModel: "text-embedding-v4", EmbedSendsDims: true},
	providers.ProviderZAI: {Base: "https://api.z.ai/api/paas/v4", ChatModel: "glm-5.3"},
}

// presetOf returns a provider's preset, if it is one.
func presetOf(provider string) (preset, bool) {
	p, ok := presets[provider]
	return p, ok
}

// presetBase is the base a preset connection is served on: the one the user
// stored, else the preset's own.
func presetBase(provider, stored string) string {
	if base := normalizeBaseFor(provider, stored); base != "" {
		return base
	}
	return presets[provider].Base
}

// presetOrder is the display order on the Connections page, after the four
// first-party providers and before openai_compat.
var presetOrder = []string{
	providers.ProviderDeepSeek,
	providers.ProviderQwen,
	providers.ProviderMistral,
	providers.ProviderXAI,
	providers.ProviderGroq,
	providers.ProviderZAI,
}
