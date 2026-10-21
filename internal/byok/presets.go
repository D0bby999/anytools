package byok

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
// The rows themselves live in catalog.go, one per provider. Model ids follow
// models.go's rule: a model id is written there or in a user's route entry,
// never inline in a client.

// preset describes one OpenAI-compatible provider.
type preset struct {
	// Base is the default API base, INCLUDING its version segment — Z.AI's is
	// /v4 and DashScope's is /compatible-mode/v1, so no single "append /v1"
	// rule covers them.
	Base string
	// ChatModel is empty for the providers added from postclaw's catalog: a
	// route on one names a model from its live list (catalog.go).
	ChatModel string
	// EmbedModel is empty when the provider has no embeddings endpoint.
	EmbedModel string
	// EmbedSendsDims says whether the embeddings endpoint accepts OpenAI's
	// `dimensions` field. Mistral's does not, and rejects the request.
	EmbedSendsDims bool
}

// presets are the catalog rows that carry one (catalog.go), by provider id.
var presets = func() map[string]preset {
	out := map[string]preset{}
	for _, r := range catalogRows {
		if r.preset != nil {
			out[r.Type] = *r.preset
		}
	}
	return out
}()

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
