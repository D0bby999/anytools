package providers

import (
	"net/url"
	"strings"
)

// Google-specific request handling for OpenAIProvider.
//
// Gemini API keys (provider_type "gemini_native") are served through Google's
// OpenAI-compatibility shim at generativelanguage.googleapis.com/v1beta/openai,
// so they ride the shared OpenAIProvider transport. That shim is NOT a tolerant
// OpenAI clone: it parses the body with a strict protobuf JSON parser that
// REJECTS any field it does not know, with
//
//	HTTP 400 Invalid JSON payload received. Unknown name "<field>": Cannot find field.
//
// Tolerant gateways (OpenAI, OpenRouter, Groq, DeepSeek…) ignore extras, so a
// body that is fine everywhere else is fatal here — and fatal for EVERY call,
// not just the ones that use the field: the parser refuses the whole request
// even when the value is the neutral default (frequency_penalty: 0 still 400s).
//
// This is what made a perfectly valid Gemini key look completely broken: the
// agent loop sets frequency_penalty on every turn (internal/agent/loop.go, the
// MiMo anti-repetition fix), so every chat and content call through a Gemini
// BYOK key 400'd, and BYOK never falls back to a system key. Customer report
// 2026-09-13: "mới nâng pro add api gemini mà ko chạy được gì".
//
// The remedy is the one 9router uses for the same class of endpoint: forward a
// known-good set and drop what the endpoint cannot parse
// (translator/request/openai-to-gemini.js carries only temperature, top_p,
// top_k and max_tokens into generationConfig; executors/codex.js and
// executors/grok-cli.js `delete body.frequency_penalty` outright).

// googleShimUnsupportedFields are body fields Google's OpenAI shim answers 400
// "Unknown name" to. Measured against the live endpoint on 2026-09-13 with a
// real key; everything else buildRequestBody can emit (temperature, top_p,
// max_tokens, stop, user, tools, tool_choice, stream_options, response_format,
// reasoning_effort) was accepted and is left alone.
//
// To extend: probe the field against the live shim first. A field that IS
// accepted must not be listed here — stripping it would silently discard a
// caller's setting.
var googleShimUnsupportedFields = []string{
	OptFrequencyPenalty,  // "frequency_penalty" — set on every agent turn
	OptRepetitionPenalty, // "repetition_penalty" — OpenRouter-dialect sibling
	OptEnableThinking,    // "enable_thinking"  — DashScope passthrough
	OptThinkingBudget,    // "thinking_budget"  — DashScope passthrough
}

// isGoogleOpenAIShim reports whether this provider instance talks to Google's
// OpenAI-compatibility endpoint.
//
// Checks the base URL as well as the name for the same reason isOpenRouter
// does: the name is caller-supplied. BYOK passes the provider_type
// ("gemini_native"), but a user may equally add the same endpoint under the
// generic "openai_compat" type by pasting Google's URL, and the system wiring
// mints derived names for the same endpoint. Matching on the host covers both.
//
// The URL check parses and matches the HOST SUFFIX rather than substring-
// searching the base URL: a BYOK api_base is attacker-chosen text, and
// "https://evil.test/generativelanguage.googleapis.com/v1" contains the string
// without being Google. Nothing secret is at stake either way (stripping a
// sampling field is harmless), but the check should not be the weak link.
func (p *OpenAIProvider) isGoogleOpenAIShim() bool {
	if p.name == "gemini_native" {
		return true
	}

	u, err := url.Parse(p.apiBase)
	if err != nil || u.Host == "" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "generativelanguage.googleapis.com" ||
		strings.HasSuffix(host, ".generativelanguage.googleapis.com")
}

// applyGoogleShimCompat drops the fields Google's OpenAI shim refuses to parse.
// No-op for every other provider — the fields stay on the wire wherever they
// are understood, so callers that rely on frequency_penalty (the agent loop's
// anti-repetition setting) keep it everywhere except the one endpoint that
// cannot accept it at all.
func (p *OpenAIProvider) applyGoogleShimCompat(body map[string]interface{}) {
	if !p.isGoogleOpenAIShim() {
		return
	}
	for _, f := range googleShimUnsupportedFields {
		delete(body, f)
	}
}
