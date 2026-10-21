package providers

// OAuth (Claude Pro/Max subscription) serving for the Anthropic provider.
//
// A subscription token is NOT an API key: Anthropic gates the OAuth path behind
// the Claude Code CLI's exact request shape. Ported from decolua/9router and
// diegosouzapw/OmniRoute (both MIT), verified 260830. What the shape requires:
//   - Authorization: Bearer <oauth token>, NEVER x-api-key
//   - anthropic-beta MUST include oauth-2025-04-20 (adds claude-code-20250219
//     when the request carries both system and tools)
//   - two system blocks prepended verbatim: a billing header, then the literal
//     "You are Claude Code, Anthropic's official CLI for Claude." Without them
//     Anthropic 401s the token as a non-CLI caller.
//   - metadata.user_id carrying a per-connection device_id (stable across
//     refresh, like Kimi's) so several accounts behind one host are not linked.
//   - third-party tool names cloaked, else a misleading 400.
// Everything runs server-side (token exchange, refresh, serve) — api.anthropic.com
// does not IP-block datacenters. See the private design notes + scratchpad notes.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"

	"github.com/google/uuid"
)

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

const (
	// anthropicOAuthBeta is the only load-bearing beta flag; the rest are
	// request-shape-derived. claude-code-20250219 is added when system+tools.
	anthropicOAuthBeta     = "oauth-2025-04-20"
	anthropicClaudeCodeBta = "claude-code-20250219"
	// claudeCLIUserAgent identifies the request as the official CLI. Version is
	// a moving pin captured from real CLI traffic; treat oauth beta as the only
	// hard constant.
	claudeCLIUserAgent = "claude-cli/2.1.220 (external, cli)"
	// The two mandatory system blocks. [0] billing header, [1] identity.
	claudeBillingSystemBlock  = "x-anthropic-billing-header: cc_version=2.1.220.1f2; cc_entrypoint=cli; cch=00000;"
	claudeIdentitySystemBlock = "You are Claude Code, Anthropic's official CLI for Claude."
)

// WithAnthropicOAuth switches the provider to subscription-OAuth serving.
// deviceID is a stable 64-hex per-connection id (persisted in settings.oauth,
// reused across refresh); accountUUID comes from the bootstrap call (may be
// empty — a shape-correct fallback is synthesized).
func WithAnthropicOAuth(deviceID, accountUUID string) AnthropicOption {
	return func(p *AnthropicProvider) {
		p.oauthMode = true
		p.oauthDeviceID = deviceID
		p.oauthAccountUUID = accountUUID
		// One session id for the life of this provider instance (one connection,
		// rebuilt per agent-cache cycle) — a stable turn identity, not per-call.
		p.oauthSessionID = uuid.NewString()
	}
}

// applyOAuthShape mutates a built request body into the Claude-Code CLI shape.
// No-op unless oauthMode. Idempotent on retry (it strips prior injected copies
// before re-prepending), matching OmniRoute's base executor.
func (p *AnthropicProvider) applyOAuthShape(body map[string]interface{}, sessionID string) {
	if !p.oauthMode {
		return
	}

	// 1) Prepend the two mandatory system blocks (no cache_control on them).
	existing, _ := body["system"].([]map[string]interface{})
	// Strip any prior injected copies so a retried body doesn't stack them.
	kept := existing[:0:0]
	for _, blk := range existing {
		if txt, _ := blk["text"].(string); txt == claudeBillingSystemBlock || txt == claudeIdentitySystemBlock {
			continue
		}
		kept = append(kept, blk)
	}
	injected := []map[string]interface{}{
		{"type": "text", "text": claudeBillingSystemBlock},
		{"type": "text", "text": claudeIdentitySystemBlock},
	}
	body["system"] = append(injected, kept...)

	// 2) metadata.user_id — exact JSON string, key order per the CLI wire image.
	//    device_id stable per connection; account_uuid + session_id identify the
	//    account/turn so Anthropic sees one consistent client, not N behind a host.
	acct := p.oauthAccountUUID
	if acct == "" {
		acct = deriveAccountUUID(p.oauthDeviceID)
	}
	userID := `{"device_id":"` + p.oauthDeviceID + `","account_uuid":"` + acct + `","session_id":"` + sessionID + `"}`
	body["metadata"] = map[string]interface{}{"user_id": userID}

	// 3) Fable/Opus/Sonnet 5 reject non-default sampling under OAuth with a 400.
	if isClaude5Model(body["model"]) {
		delete(body, "temperature")
		delete(body, "top_p")
		delete(body, "top_k")
	}
}

// oauthBetaHeader returns the anthropic-beta value for a request body.
func oauthBetaHeader(body interface{}) string {
	beta := anthropicOAuthBeta
	if m, ok := body.(map[string]interface{}); ok {
		_, hasSystem := m["system"]
		_, hasTools := m["tools"]
		if hasSystem && hasTools {
			beta += "," + anthropicClaudeCodeBta
		}
		if _, hasThinking := m["thinking"]; hasThinking {
			beta += ",interleaved-thinking-2025-05-14"
		}
	}
	return beta
}

func isClaude5Model(model interface{}) bool {
	s, _ := model.(string)
	// fable-5 / opus-5 / sonnet-5 (but not opus-4-x / sonnet-4-x / haiku-4-x).
	return strings.Contains(s, "fable-5") ||
		strings.Contains(s, "opus-5") ||
		strings.Contains(s, "sonnet-5")
}

// deriveAccountUUID produces a shape-correct (uuid-like) fallback from the
// device id when bootstrap did not return the real account_uuid — Anthropic
// only checks the shape here, and a stable value keeps the client consistent.
func deriveAccountUUID(deviceID string) string {
	h := sha256Hex(deviceID)
	if len(h) < 32 {
		return "00000000-0000-4000-8000-000000000000"
	}
	return h[0:8] + "-" + h[8:12] + "-4" + h[13:16] + "-8" + h[17:20] + "-" + h[20:32]
}

// marshalOAuthBody is a tiny helper so tests can inspect the shaped body.
func marshalOAuthBody(body map[string]interface{}) ([]byte, error) {
	return json.Marshal(body)
}
