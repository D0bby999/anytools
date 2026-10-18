package providers

// catalog.go — the small amount of per-provider knowledge the error path needs.
//
// The spike's A1 port set reaches exactly one symbol from postclaw's
// providers/catalog package — CadenceForProvider, called from
// ApplyQuotaResetCooldown (reset_cooldown.go). postclaw's catalog is a large
// table of models, prices and capabilities that AnyTools does not have and does
// not want: model ids move fast, and a stale price table is worse than none.
// So this is the cadence lookup and nothing else.

// CadenceForProvider returns how often a provider's PERIOD allowance resets, or
// "" when that is unknown.
//
// Only a provider whose free/plan quota genuinely resets on a calendar boundary
// belongs here. The value is used to bench a quota-exhausted connection until
// that boundary instead of re-probing it on the short rate-limit curve; naming a
// cadence the provider does not actually keep would park a healthy connection
// for up to 25 hours, so the honest answer for anything uncertain is "".
//
// Verified 2026-09-16 against ~/.claude/rules/9router-media-api.md and each
// provider's own published limits:
//   - gemini: Google's free tier is a requests-per-DAY allowance, reset at
//     midnight Pacific; "daily" is the right shape even though the boundary
//     this code uses is UTC (NextResetCooldown caps the wait at 25h either way).
//   - openai / anthropic / openrouter: pay-as-you-go balances that do not reset
//     on a clock at all — they are topped up. A 429 there is a rate limit or an
//     empty balance, and both want the ordinary backoff curve.
func CadenceForProvider(providerType string) string {
	switch providerType {
	case ProviderGemini:
		return "daily"
	default:
		return ""
	}
}

// Provider type identifiers. These are the values stored in
// provider_connections.provider, so they are a wire contract with the database
// and must not be renamed without a migration.
const (
	ProviderOpenAI       = "openai"
	ProviderGemini       = "gemini"
	ProviderAnthropic    = "anthropic"
	ProviderOpenRouter   = "openrouter"
	ProviderOpenAICompat = "openai_compat"
	// OpenAI-compatible providers at a known address (internal/byok/presets.go).
	ProviderDeepSeek = "deepseek"
	ProviderXAI      = "xai"
	ProviderMistral  = "mistral"
	ProviderGroq     = "groq"
	ProviderQwen     = "qwen"
	ProviderZAI      = "zai"
	// ProviderChatGPTRelay and ProviderGeminiSub are the two experimental
	// subscription lanes. They are listed here because the database CHECK
	// accepts them, not because they are on by default — internal/byok gates
	// both behind ANYTOOLS_EXPERIMENTAL_SUBSCRIPTION_LANES.
	ProviderChatGPTRelay = "chatgpt_relay"
	ProviderGeminiSub    = "gemini_code_assist"
	// ProviderGitHubCopilot and ProviderClaudeSub are subscription lanes too,
	// behind the same flag (internal/oauth/copilot.go, claude.go).
	ProviderGitHubCopilot = "github_copilot"
	ProviderClaudeSub     = "claude_sub"
)
