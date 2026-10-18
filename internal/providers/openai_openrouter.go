package providers

import (
	"net/url"
	"strings"
)

// OpenRouter-specific request/response handling for OpenAIProvider.
//
// OpenRouter speaks the OpenAI chat-completions dialect, so it rides the shared
// OpenAIProvider transport rather than getting its own client. The handful of
// places where it genuinely diverges live here instead of being sprinkled
// through openai.go as `if p.name == "openrouter"` checks.
//
// DELIBERATELY NOT IMPLEMENTED — provider routing preferences
// (`provider: {order: [...]}`). Pinning the upstream order disables OpenRouter's
// sticky routing, which defeats prompt-cache affinity and makes cache_read
// tokens collapse to zero. See systemContentWithCacheControl in openai.go for
// the same rule stated from the caching side. Do not "complete" this file by
// adding it.

const (
	// openRouterRefererURL / openRouterAppTitle identify this app to OpenRouter.
	// Sent as HTTP-Referer / X-Title. Some upstream models gate access on a
	// declared app identity, and traffic without them is unattributed.
	openRouterRefererURL = "https://anytools.world"
	openRouterAppTitle   = "AnyTools"
)

// isOpenRouter reports whether this provider instance talks to OpenRouter.
//
// Checks the base URL as well as the name because the name is caller-supplied:
// BYOK passes the provider_type ("openrouter"), but the system wiring also
// mints derived names like "<svc>-tts" for the same endpoint
// (cmd/gateway_providers.go). Matching on the host keeps those variants working.
//
// The URL check parses and matches the HOST SUFFIX rather than doing a substring
// search on the whole base URL. A user-supplied BYOK api_base is attacker-chosen
// text: "https://evil.test/openrouter.ai/v1" contains the string but is not
// OpenRouter, and a substring match would have sent this app's attribution
// headers to it. Nothing secret leaks either way (the Authorization header is
// that user's own key), but the check should not be the weak link.
func (p *OpenAIProvider) isOpenRouter() bool {
	if p.name == "openrouter" {
		return true
	}

	u, err := url.Parse(p.apiBase)
	if err != nil || u.Host == "" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "openrouter.ai" || strings.HasSuffix(host, ".openrouter.ai")
}

// applyOpenRouterUsageAccounting opts the request into OpenRouter's usage
// accounting, which adds a `cost` field (USD, already net of that request's
// actual upstream routing) to the usage object on both the final streamed chunk
// and the non-streamed response.
//
// This is the authoritative per-call price. Everything else in this codebase
// prices a call by looking the model up in the model_pricing table and
// multiplying token counts — which silently falls back to the deepseek-v3 rate
// for any model missing a row (internal/credits/pricing.go). For OpenRouter,
// which is the production path, that guesswork is unnecessary: the gateway
// tells us exactly what the call cost.
//
// Costs one extra accounting hop on OpenRouter's side; no added latency to the
// generation itself.
func (p *OpenAIProvider) applyOpenRouterUsageAccounting(body map[string]interface{}) {
	if !p.isOpenRouter() {
		return
	}
	body["usage"] = map[string]interface{}{"include": true}
}
