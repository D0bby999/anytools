package byok

import (
	"hash/fnv"

	"github.com/D0bby999/anytools/internal/providers"
)

// catalog.go — every provider a learner can connect, in one table (plan
// 261021-1100 phase 4, after postclaw's internal/providers/catalog).
//
// The rows are the chat-capable entries of postclaw's catalog, which ports
// 9router's provider registry (MIT, see THIRD-PARTY-NOTICES.md), minus three
// groups on purpose:
//
//   - media-only providers (image, video, music, voice): AnyTools has no lane
//     for them;
//   - postclaw's sign-in lanes, which AnyTools carries as its own four
//     subscription lanes below;
//   - "coding plan" and "token plan" endpoints (Z.AI Coding, Bailian and
//     Alibaba Coding, Kimi Coding, BytePlus and Volcengine coding, GLM China
//     coding, OpenCode, the Alibaba and Xiaomi token plans): their terms tie
//     the key to coding tools, which a study app is not.
//
// Everything else a provider differs by is data here. A row with a preset is
// an OpenAI-compatible provider at a known address, served by the same
// providers.OpenAIProvider as every OpenAI-shaped lane; presets, the API-key
// list and the display order are all derived from this table, so there is no
// second list to drift.
//
// Default chat models: the ten providers AnyTools had before this table keep
// theirs (models.go's dated rule). The rows added from postclaw's catalog
// carry none on purpose. Model ids there change monthly and could not be
// checked without a key for each, so instead of guessing, a connection lists
// its live models with the learner's own key (ListModels) and the learner
// picks one; Verify reads that list when no model is chosen yet.
//
// The provider column has a CHECK listing these ids;
// TestCatalogMatchesTheDatabaseCheck pins the two together.

// Auth kinds a catalog entry can have.
const (
	AuthAPIKey = "api_key" // paste a key
	AuthSignIn = "sign_in" // a subscription lane, behind the experimental flag
	AuthCustom = "custom"  // a base URL and a key the learner brings
)

type catalogRow struct {
	Type   string
	Label  string
	Icon   string // two letters on the provider's tile
	Auth   string
	Free   bool   // has a free tier
	KeyURL string // where the provider hands out keys
	preset *preset
}

// p is a preset with a base and no default model (see the note above).
func p(base string) *preset { return &preset{Base: base} }

var catalogRows = []catalogRow{
	// First-party clients.
	{Type: providers.ProviderGemini, Label: "Google Gemini", Icon: "GE", Auth: AuthAPIKey, Free: true, KeyURL: "https://aistudio.google.com/apikey"},
	{Type: providers.ProviderOpenAI, Label: "OpenAI", Icon: "OA", Auth: AuthAPIKey, KeyURL: "https://platform.openai.com/api-keys"},
	{Type: providers.ProviderAnthropic, Label: "Anthropic", Icon: "AN", Auth: AuthAPIKey, KeyURL: "https://console.anthropic.com/settings/keys"},
	{Type: providers.ProviderOpenRouter, Label: "OpenRouter", Icon: "OR", Auth: AuthAPIKey, Free: true, KeyURL: "https://openrouter.ai/settings/keys"},

	// Presets AnyTools had before the catalog, dated 2026-09-26. The chat ids
	// were taken from postclaw's provider defaults where it had one (Groq's
	// Llama ids were shut down in 2026 in favour of gpt-oss; DeepSeek's
	// `deepseek-chat` is its stable alias).
	{Type: providers.ProviderDeepSeek, Label: "DeepSeek", Icon: "DS", Auth: AuthAPIKey, KeyURL: "https://platform.deepseek.com/api_keys",
		preset: &preset{Base: "https://api.deepseek.com/v1", ChatModel: "deepseek-chat"}},
	// Alibaba's international endpoint. text-embedding-v4 defaults to 1024 and
	// honours `dimensions`.
	{Type: providers.ProviderQwen, Label: "Qwen (DashScope)", Icon: "QW", Auth: AuthAPIKey, KeyURL: "https://bailian.console.alibabacloud.com/",
		preset: &preset{Base: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", ChatModel: "qwen3-max",
			EmbedModel: "text-embedding-v4", EmbedSendsDims: true}},
	// mistral-embed is 1024 wide, one of the widths the vector column takes.
	{Type: providers.ProviderMistral, Label: "Mistral AI", Icon: "MI", Auth: AuthAPIKey, Free: true, KeyURL: "https://console.mistral.ai/api-keys",
		preset: &preset{Base: "https://api.mistral.ai/v1", ChatModel: "mistral-medium-latest", EmbedModel: "mistral-embed"}},
	{Type: providers.ProviderXAI, Label: "xAI (Grok)", Icon: "XA", Auth: AuthAPIKey, KeyURL: "https://console.x.ai",
		preset: &preset{Base: "https://api.x.ai/v1", ChatModel: "grok-4"}},
	{Type: providers.ProviderGroq, Label: "Groq", Icon: "GQ", Auth: AuthAPIKey, Free: true, KeyURL: "https://console.groq.com/keys",
		preset: &preset{Base: "https://api.groq.com/openai/v1", ChatModel: "openai/gpt-oss-120b"}},
	{Type: providers.ProviderZAI, Label: "Z.AI (GLM)", Icon: "ZA", Auth: AuthAPIKey, KeyURL: "https://z.ai/manage-apikey/apikey-list",
		preset: &preset{Base: "https://api.z.ai/api/paas/v4", ChatModel: "glm-5.3"}},

	// From postclaw's catalog, 2026-10-21, alphabetical.
	{Type: "agnes", Label: "Agnes AI", Icon: "AG", Auth: AuthAPIKey, Free: true, KeyURL: "https://platform.agnes-ai.com", preset: p("https://apihub.agnes-ai.com/v1")},
	{Type: "api_airforce", Label: "API.airforce", Icon: "AF", Auth: AuthAPIKey, Free: true, KeyURL: "https://api.airforce", preset: p("https://api.airforce/v1")},
	{Type: "atria", Label: "Atria Dawn", Icon: "AD", Auth: AuthAPIKey, KeyURL: "https://api.atria-asi.ai/dashboard", preset: p("https://api.atria-asi.ai/v1")},
	{Type: "bai", Label: "B.AI", Icon: "BA", Auth: AuthAPIKey, KeyURL: "https://b.ai", preset: p("https://api.b.ai/v1")},
	{Type: "baidu", Label: "Baidu Qianfan", Icon: "BD", Auth: AuthAPIKey, KeyURL: "https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application", preset: p("https://qianfan.baidubce.com/v2")},
	{Type: "bazaarlink", Label: "Bazaarlink", Icon: "BZ", Auth: AuthAPIKey, Free: true, KeyURL: "https://bazaarlink.ai", preset: p("https://bazaarlink.ai/api/v1")},
	{Type: "blackbox", Label: "Blackbox AI", Icon: "BB", Auth: AuthAPIKey, KeyURL: "https://www.blackbox.ai/api-management", preset: p("https://api.blackbox.ai/v1")},
	{Type: "bluesminds", Label: "BluesMinds", Icon: "BM", Auth: AuthAPIKey, KeyURL: "https://bluesminds.com", preset: p("https://api.bluesminds.com/v1")},
	{Type: "cerebras", Label: "Cerebras", Icon: "CB", Auth: AuthAPIKey, Free: true, KeyURL: "https://cloud.cerebras.ai/platform", preset: p("https://api.cerebras.ai/v1")},
	{Type: "chutes", Label: "Chutes AI", Icon: "CH", Auth: AuthAPIKey, KeyURL: "https://chutes.ai/app/api", preset: p("https://llm.chutes.ai/v1")},
	{Type: "cohere", Label: "Cohere", Icon: "CO", Auth: AuthAPIKey, Free: true, KeyURL: "https://dashboard.cohere.com/api-keys", preset: p("https://api.cohere.ai/compatibility/v1")},
	{Type: "dahl", Label: "Dahl Inference", Icon: "DH", Auth: AuthAPIKey, KeyURL: "https://dahl.global/dashboard", preset: p("https://inference.dahl.global/v1")},
	{Type: "featherless", Label: "Featherless", Icon: "FL", Auth: AuthAPIKey, KeyURL: "https://featherless.ai/account/api-keys", preset: p("https://api.featherless.ai/v1")},
	{Type: "fireworks", Label: "Fireworks AI", Icon: "FW", Auth: AuthAPIKey, KeyURL: "https://fireworks.ai/account/api-keys", preset: p("https://api.fireworks.ai/inference/v1")},
	{Type: "hyperbolic", Label: "Hyperbolic", Icon: "HB", Auth: AuthAPIKey, KeyURL: "https://app.hyperbolic.xyz/settings", preset: p("https://api.hyperbolic.xyz/v1")},
	{Type: "kilo_gateway", Label: "Kilo Gateway", Icon: "KG", Auth: AuthAPIKey, Free: true, KeyURL: "https://kilo.ai/dashboard?tab=apiKeys", preset: p("https://api.kilo.ai/api/gateway")},
	{Type: "kimchi", Label: "Kimchi", Icon: "KC", Auth: AuthAPIKey, Free: true, KeyURL: "https://kimchi.dev", preset: p("https://llm.kimchi.dev/openai/v1")},
	{Type: "llm7", Label: "LLM7", Icon: "L7", Auth: AuthAPIKey, KeyURL: "https://llm7.io", preset: p("https://api.llm7.io/v1")},
	{Type: "minimax", Label: "MiniMax", Icon: "MM", Auth: AuthAPIKey, KeyURL: "https://platform.minimax.io/user-center/basic-information/interface-key", preset: p("https://api.minimax.io/v1")},
	{Type: "morph", Label: "Morph", Icon: "MP", Auth: AuthAPIKey, KeyURL: "https://morphllm.com", preset: p("https://api.morphllm.com/v1")},
	{Type: "muse", Label: "Muse (Meta Model API)", Icon: "MU", Auth: AuthAPIKey, KeyURL: "https://dev.meta.ai", preset: p("https://api.meta.ai/v1")},
	{Type: "nebius", Label: "Nebius AI", Icon: "NB", Auth: AuthAPIKey, KeyURL: "https://studio.nebius.com/settings/api-keys", preset: p("https://api.studio.nebius.ai/v1")},
	{Type: "nvidia", Label: "NVIDIA NIM", Icon: "NV", Auth: AuthAPIKey, Free: true, KeyURL: "https://build.nvidia.com/settings/api-keys", preset: p("https://integrate.api.nvidia.com/v1")},
	{Type: "ollama_cloud", Label: "Ollama Cloud", Icon: "OL", Auth: AuthAPIKey, Free: true, KeyURL: "https://ollama.com/settings/keys", preset: p("https://ollama.com/v1")},
	{Type: "perplexity", Label: "Perplexity", Icon: "PP", Auth: AuthAPIKey, KeyURL: "https://www.perplexity.ai/settings/api", preset: p("https://api.perplexity.ai")},
	{Type: "poolside", Label: "Poolside", Icon: "PS", Auth: AuthAPIKey, Free: true, KeyURL: "https://platform.poolside.ai/api-keys", preset: p("https://inference.poolside.ai/v1")},
	{Type: "sambanova", Label: "SambaNova", Icon: "SN", Auth: AuthAPIKey, Free: true, KeyURL: "https://cloud.sambanova.ai/apis", preset: p("https://api.sambanova.ai/v1")},
	{Type: "siliconflow", Label: "SiliconFlow", Icon: "SF", Auth: AuthAPIKey, KeyURL: "https://cloud.siliconflow.com/account/ak", preset: p("https://api.siliconflow.com/v1")},
	{Type: "tencent", Label: "Tencent Hunyuan", Icon: "TH", Auth: AuthAPIKey, KeyURL: "https://console.cloud.tencent.com/hunyuan/api-key", preset: p("https://api.hunyuan.cloud.tencent.com/v1")},
	{Type: "together", Label: "Together AI", Icon: "TG", Auth: AuthAPIKey, KeyURL: "https://api.together.xyz/settings/api-keys", preset: p("https://api.together.xyz/v1")},
	{Type: "tokenharbor", Label: "Token Harbor", Icon: "TB", Auth: AuthAPIKey, KeyURL: "https://tokenharbor.ai/dashboard", preset: p("https://tokenharbor.ai/v1")},
	{Type: "tokenrouter", Label: "TokenRouter", Icon: "TR", Auth: AuthAPIKey, KeyURL: "https://www.tokenrouter.com", preset: p("https://api.tokenrouter.com/v1")},
	{Type: "venice", Label: "Venice AI", Icon: "VE", Auth: AuthAPIKey, KeyURL: "https://venice.ai/settings/api", preset: p("https://api.venice.ai/api/v1")},
	{Type: "vercel_ai_gateway", Label: "Vercel AI Gateway", Icon: "VG", Auth: AuthAPIKey, KeyURL: "https://vercel.com/dashboard/~/ai-gateway", preset: p("https://ai-gateway.vercel.sh/v1")},
	{Type: "xiaomi_mimo", Label: "Xiaomi MiMo", Icon: "XM", Auth: AuthAPIKey, KeyURL: "https://platform.xiaomimimo.com/console/api-keys", preset: p("https://api.xiaomimimo.com/v1")},
	{Type: "yescale", Label: "YesScale", Icon: "YS", Auth: AuthAPIKey, KeyURL: "https://yescale.one", preset: p("https://api.yescale.one/v1")},

	// Any other OpenAI-compatible server: the learner brings the address too.
	{Type: providers.ProviderOpenAICompat, Label: "Custom endpoint", Icon: "</>", Auth: AuthCustom},

	// Subscription lanes, behind ANYTOOLS_EXPERIMENTAL_SUBSCRIPTION_LANES.
	{Type: providers.ProviderChatGPTRelay, Label: "ChatGPT (subscription)", Icon: "CG", Auth: AuthSignIn},
	{Type: providers.ProviderGeminiSub, Label: "Gemini Code Assist", Icon: "GC", Auth: AuthSignIn},
	{Type: providers.ProviderGitHubCopilot, Label: "GitHub Copilot", Icon: "GH", Auth: AuthSignIn},
	{Type: providers.ProviderClaudeSub, Label: "Claude (subscription)", Icon: "CL", Auth: AuthSignIn},
}

// CatalogEntry is one provider as the Providers page shows it.
type CatalogEntry struct {
	Type   string `json:"type"`
	Label  string `json:"label"`
	Icon   string `json:"icon"`
	Auth   string `json:"auth"`
	Free   bool   `json:"free_tier,omitempty"`
	KeyURL string `json:"key_url,omitempty"`
	// APIBase is where a preset is served; empty for first-party clients,
	// which know their own, and for a custom endpoint.
	APIBase string `json:"api_base,omitempty"`
	// Hue is the part ink its tile wears (read, ask, practise, reflect,
	// tools, brand): a token name, never a colour.
	Hue string `json:"hue"`
	// Serves lists what it can do here: chat, parse, embed, tts, stt.
	Serves []string `json:"serves"`
	// NeedsModel is true when there is no default model, so a route on it
	// must name one (picked from the live list).
	NeedsModel bool `json:"needs_model,omitempty"`
}

var hues = []string{"read", "ask", "practise", "reflect", "tools", "brand"}

// hueOf spreads tiles over the part inks by name, so a provider keeps its
// colour wherever it appears and nobody has to pick one per row.
func hueOf(provider string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(provider))
	return hues[h.Sum32()%uint32(len(hues))]
}

// kindNames name the client shapes, as the Providers page filters by them.
var kindNames = []struct {
	kind Kind
	name string
	fn   Function
}{
	{KindChat, "chat", FunctionChat},
	{KindParse, "parse", FunctionParse},
	{KindEmbed, "embed", FunctionEmbed},
	{KindTTS, "tts", FunctionTTS},
	{KindSTT, "stt", FunctionSTT},
}

// Catalog lists every provider a learner can connect, in display order. The
// subscription lanes are included only when they are enabled.
func Catalog(lanes bool) []CatalogEntry {
	out := make([]CatalogEntry, 0, len(catalogRows))
	for _, r := range catalogRows {
		if r.Auth == AuthSignIn && !lanes {
			continue
		}
		e := CatalogEntry{Type: r.Type, Label: r.Label, Icon: r.Icon, Auth: r.Auth, Free: r.Free,
			KeyURL: r.KeyURL, Hue: hueOf(r.Type), NeedsModel: defaultChatModel(r.Type) == ""}
		if r.preset != nil {
			e.APIBase = r.preset.Base
		}
		for _, k := range kindNames {
			if ProviderSupports(r.Type, k.fn) && (r.Auth != AuthSignIn || k.kind == KindChat) {
				e.Serves = append(e.Serves, k.name)
			}
		}
		out = append(out, e)
	}
	return out
}

// CatalogEntryFor returns one provider's entry.
func CatalogEntryFor(provider string, lanes bool) (CatalogEntry, bool) {
	for _, e := range Catalog(lanes) {
		if e.Type == provider {
			return e, true
		}
	}
	return CatalogEntry{}, false
}

// catalogTypes lists every provider id, the order the CHECK test reads.
func catalogTypes() []string {
	out := make([]string, len(catalogRows))
	for i, r := range catalogRows {
		out[i] = r.Type
	}
	return out
}
