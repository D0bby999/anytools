package providers

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/security"
)

// OpenAIProvider implements Provider for OpenAI-compatible APIs
// (OpenAI, Groq, OpenRouter, DeepSeek, VLLM, etc.)
type OpenAIProvider struct {
	name    string
	apiKey  string
	apiBase string
	// chatPath is always "/chat/completions". postclaw made it settable for
	// MiniMax's native path; AnyTools supports no provider that needs another,
	// and a setter nothing calls is a setter nobody maintains.
	chatPath     string
	defaultModel string
	client       *http.Client
	retryConfig  RetryConfig
	// extraHeaders are sent on every request (Copilot's editor identity).
	extraHeaders map[string]string
}

func NewOpenAIProvider(name, apiKey, apiBase, defaultModel string) *OpenAIProvider {
	if apiBase == "" {
		apiBase = "https://api.openai.com/v1"
	}
	apiBase = strings.TrimRight(apiBase, "/")

	return &OpenAIProvider{
		name:         name,
		apiKey:       apiKey,
		apiBase:      apiBase,
		chatPath:     "/chat/completions",
		defaultModel: defaultModel,
		client:       security.SafeBYOKClient(300 * time.Second), // SSRF-hardened egress (audit C2)
		retryConfig:  DefaultRetryConfig(),
	}
}

func (p *OpenAIProvider) Name() string           { return p.name }
func (p *OpenAIProvider) DefaultModel() string   { return p.defaultModel }
func (p *OpenAIProvider) SupportsThinking() bool { return true }
func (p *OpenAIProvider) APIKey() string         { return p.apiKey }
func (p *OpenAIProvider) APIBase() string        { return p.apiBase }

// resolveModel returns the model ID to use for a request.
// For OpenRouter, model IDs require a provider prefix (e.g. "anthropic/claude-sonnet-4-5-20250929").
// If the caller passes an unprefixed model, fall back to the provider's default.
func (p *OpenAIProvider) resolveModel(model string) string {
	if model == "" {
		return p.defaultModel
	}
	if p.name == "openrouter" && !strings.Contains(model, "/") {
		return p.defaultModel
	}
	return model
}

func (p *OpenAIProvider) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	model := p.resolveModel(req.Model)

	once := func(r ChatRequest) (*ChatResponse, error) {
		body := p.buildRequestBody(model, r, false)
		return RetryDo(ctx, p.retryConfig, func() (*ChatResponse, error) {
			respBody, err := p.doRequest(ctx, body)
			if err != nil {
				return nil, err
			}
			defer respBody.Close()

			var oaiResp openAIResponse
			if err := json.NewDecoder(respBody).Decode(&oaiResp); err != nil {
				return nil, fmt.Errorf("%s: decode response: %w", p.name, err)
			}

			parsed := p.parseResponse(&oaiResp)
			// A6: normal "stop" carrying nothing at all is a transient upstream
			// glitch, not an answer — classify inside RetryDo so it retries with
			// backoff instead of poisoning history with an empty assistant
			// message. Reasoning starvation ("length") stays with the self-heal
			// below, which owns that case.
			if isEmptyStopResponse(parsed) {
				return nil, fmt.Errorf("%s: %w", p.name, ErrEmptyResponse)
			}
			return parsed, nil
		})
	}

	resp, err := once(req)
	if err != nil {
		return nil, err
	}

	// Self-heal reasoning starvation: a reasoning model (e.g. MiMo, DeepSeek-R1,
	// o-series) can spend its whole max_tokens budget on internal reasoning and
	// return empty content with finish_reason="length". Retry once with a generous
	// cap so the actual output fits. Model-agnostic — protects every caller,
	// including small-cap ones (intent router=64, scout=250, brand voice=512…),
	// without bloating normal calls (only fires on this exact failure).
	if isReasoningStarvation(resp) {
		bumped := bumpedMaxTokens(req.Options)
		slog.Warn("openai: empty content with finish_reason=length — retrying with higher max_tokens",
			"provider", p.name, "model", model,
			"orig_max_tokens", req.Options[OptMaxTokens], "new_max_tokens", bumped,
			"reasoning_tokens", reasoningTokensOf(resp))
		retry := req
		retry.Options = optionsWithMaxTokens(req.Options, bumped)
		if resp2, err2 := once(retry); err2 == nil && resp2.Content != "" {
			// M3: the starved FIRST call's usage is real provider-billed spend
			// (it burned reasoning_tokens up to the original cap) that was
			// previously discarded entirely along with `resp`. Fold it into the
			// retry's usage so metering reflects the TOTAL tokens actually billed
			// by the provider across both calls, not just the successful retry.
			mergeUsageInto(resp2, resp.Usage)
			return resp2, nil
		}
		// Self-heal didn't recover — fall through and return the original empty
		// response so the caller's existing empty-content handling still applies.
	}

	return resp, nil
}

// isReasoningStarvation reports the failure where a reasoning model consumed its
// entire token budget thinking and produced no content (finish_reason="length",
// no tool calls). Tool-call turns legitimately have empty content + finish_reason
// "tool_calls", so they are excluded.
func isReasoningStarvation(resp *ChatResponse) bool {
	return resp != nil && resp.Content == "" && len(resp.ToolCalls) == 0 && resp.FinishReason == "length"
}

// isEmptyStopResponse reports a response that finished normally ("stop") yet
// carries nothing at all — no content, no thinking, no tool calls. Appending
// such an assistant message to history poisons the conversation (some gateways
// 400 on empty assistant content on the NEXT call). Requiring Thinking=="" too
// keeps deliberate silent replies with visible reasoning out of scope.
func isEmptyStopResponse(resp *ChatResponse) bool {
	return resp != nil && resp.Content == "" && resp.Thinking == "" &&
		len(resp.ToolCalls) == 0 && resp.FinishReason == "stop"
}

// requireStreamDone gates the truncated-stream guard (default ON). A gateway
// that never emits "[DONE]" would turn every streamed call into
// ErrStreamClosed; ANYTOOLS_PROVIDER_REQUIRE_STREAM_DONE=off disables the guard
// without a code change.
//
// Read ONCE, not per call: it was in the hot path of every streamed chunk loop,
// and an env var that can change under a running process is a worse contract
// than one that is fixed at boot.
var requireStreamDone = sync.OnceValue(func() bool {
	return !strings.EqualFold(strings.TrimSpace(config.Getenv("ANYTOOLS_PROVIDER_REQUIRE_STREAM_DONE")), "off")
})

// bumpedMaxTokens returns a generous max_tokens for a self-heal retry: 4x the
// original (floor 4096, cap 16384), or 8192 when none was set.
func bumpedMaxTokens(opts map[string]interface{}) int {
	cur := intOption(opts[OptMaxTokens])
	if cur <= 0 {
		return 8192
	}
	v := cur * 4
	if v < 4096 {
		v = 4096
	}
	if v > 16384 {
		v = 16384
	}
	return v
}

func optionsWithMaxTokens(opts map[string]interface{}, n int) map[string]interface{} {
	out := make(map[string]interface{}, len(opts)+1)
	for k, v := range opts {
		out[k] = v
	}
	out[OptMaxTokens] = n
	return out
}

func intOption(v interface{}) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	}
	return 0
}

func reasoningTokensOf(resp *ChatResponse) int {
	if resp != nil && resp.Usage != nil {
		return resp.Usage.ThinkingTokens
	}
	return 0
}

func (p *OpenAIProvider) ChatStream(ctx context.Context, req ChatRequest, onChunk func(StreamChunk)) (*ChatResponse, error) {
	model := p.resolveModel(req.Model)

	// Track whether any answer content was forwarded to the caller. A truncated
	// stream (ErrStreamClosed) may only be retried transparently when nothing
	// user-visible went out — otherwise the retry would double-stream.
	var contentForwarded bool
	if userOnChunk := onChunk; userOnChunk != nil {
		onChunk = func(c StreamChunk) {
			if c.Content != "" {
				contentForwarded = true
			}
			userOnChunk(c)
		}
	}

	// once performs a single streaming attempt end-to-end (no self-heal retry,
	// no Done emission — both handled by the caller so a retry can transparently
	// re-run this without double-emitting Done).
	once := func(r ChatRequest) (*ChatResponse, error) {
		body := p.buildRequestBody(model, r, true)

		// Retry only the connection phase; once streaming starts, no retry.
		respBody, err := RetryDo(ctx, p.retryConfig, func() (io.ReadCloser, error) {
			return p.doRequest(ctx, body)
		})
		if err != nil {
			return nil, err
		}
		defer respBody.Close()

		result := &ChatResponse{FinishReason: "stop"}
		accumulators := make(map[int]*toolCallAccumulator)
		sawDone := false

		scanner := bufio.NewScanner(respBody)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024) // 1MB max line for large tool call / thinking chunks
		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "data:") {
				continue
			}
			// SSE spec allows both "data: value" and "data:value" (space is optional).
			// Some providers (e.g. Kimi) omit the space after the colon.
			data := strings.TrimPrefix(line, "data:")
			data = strings.TrimPrefix(data, " ")
			if data == "[DONE]" {
				sawDone = true
				break
			}

			var chunk openAIStreamChunk
			if err := json.Unmarshal([]byte(data), &chunk); err != nil {
				continue
			}

			// Usage chunk often has empty choices — extract usage before skipping.
			// When stream_options.include_usage is true, the final chunk contains
			// usage data but choices is typically an empty array.
			if chunk.Usage != nil {
				result.Usage = chunk.Usage.toUsage(p.isOpenRouter())
			}

			if len(chunk.Choices) == 0 {
				continue
			}

			delta := chunk.Choices[0].Delta
			if delta.ReasoningContent != "" {
				result.Thinking += delta.ReasoningContent
				if onChunk != nil {
					onChunk(StreamChunk{Thinking: delta.ReasoningContent})
				}
			}
			if delta.Content != "" {
				result.Content += delta.Content
				if onChunk != nil {
					onChunk(StreamChunk{Content: delta.Content})
				}
			}

			// Accumulate streamed tool calls
			for _, tc := range delta.ToolCalls {
				acc, ok := accumulators[tc.Index]
				if !ok {
					acc = &toolCallAccumulator{
						ToolCall: ToolCall{ID: tc.ID, Name: strings.TrimSpace(tc.Function.Name)},
					}
					accumulators[tc.Index] = acc
				}
				if tc.Function.Name != "" {
					acc.Name = strings.TrimSpace(tc.Function.Name)
				}
				acc.rawArgs += tc.Function.Arguments
				if tc.Function.ThoughtSignature != "" {
					acc.thoughtSig = tc.Function.ThoughtSignature
				}
			}

			if chunk.Choices[0].FinishReason != "" {
				result.FinishReason = chunk.Choices[0].FinishReason
				result.RawFinishReason = chunk.Choices[0].FinishReason // P01: preserve before the tool_calls overwrite below
			}

		}

		// Check for scanner errors (timeout, connection reset, etc.)
		if err := scanner.Err(); err != nil {
			return nil, fmt.Errorf("%s: stream read error: %w", p.name, err)
		}

		// A clean EOF without "[DONE]" means a proxy/gateway closed the
		// connection mid-generation. The partial content read so far is NOT a
		// complete answer — returning it silently truncates the reply (and can
		// execute half-built tool calls). ErrStreamClosed is retryable.
		// Kill switch for gateways that legitimately never send [DONE]:
		// ANYTOOLS_PROVIDER_REQUIRE_STREAM_DONE=off.
		if !sawDone && requireStreamDone() {
			slog.Warn("openai: stream ended without [DONE] — rejecting partial response",
				"provider", p.name, "model", model,
				"partial_content_bytes", len(result.Content),
				"partial_thinking_bytes", len(result.Thinking),
				"pending_tool_calls", len(accumulators))
			return nil, fmt.Errorf("%s: %w", p.name, ErrStreamClosed)
		}

		// Parse accumulated tool call arguments.
		//
		// Iterate the SORTED KEYS, not 0..len-1: the delta index is provider-chosen
		// and is not guaranteed contiguous or zero-based. Kimi/Gemini shims have been
		// seen starting at 1, and a cancelled parallel tool call leaves a hole. The
		// old `accumulators[i]` on an index-keyed map returned nil for the missing
		// key and panicked on acc.rawArgs. Sorting also keeps tool-call order stable,
		// which matters because the agent loop pairs results back by position.
		for _, idx := range slices.Sorted(maps.Keys(accumulators)) {
			acc := accumulators[idx]
			args, parseErr := parseToolArgs(acc.rawArgs)
			acc.Arguments = args
			acc.RawArguments = acc.rawArgs
			acc.ArgsParseError = parseErr
			if acc.thoughtSig != "" {
				acc.Metadata = map[string]string{"thought_signature": acc.thoughtSig}
			}
			result.ToolCalls = append(result.ToolCalls, acc.ToolCall)
		}

		if len(result.ToolCalls) > 0 {
			result.FinishReason = "tool_calls"
		}

		return result, nil
	}

	result, err := once(req)
	// One transparent re-attempt for a truncated stream, but only when no
	// answer chunk reached the caller yet (a replayed "thinking" chunk is a
	// display-only nit — same precedent as the M3 self-heal below).
	if err != nil && errors.Is(err, ErrStreamClosed) && !contentForwarded && ctx.Err() == nil {
		slog.Warn("openai: retrying truncated stream once (no content forwarded)",
			"provider", p.name, "model", model)
		result, err = once(req)
	}
	if err != nil {
		return nil, err
	}

	// M3: streaming self-heal parity with Chat() — a starved reasoning-model
	// call (empty content, finish_reason="length") burned its whole thinking
	// budget and produced nothing for the user; retry once with a higher cap.
	// Safe to retry transparently: starvation is defined as Content=="", so by
	// construction no answer chunk was ever forwarded to onChunk for THIS call —
	// nothing user-visible gets duplicated (a "thinking" chunk could in theory
	// have streamed and would replay on retry, which is a display-only nit, not
	// a correctness issue, and matches the non-streaming self-heal precedent).
	if isReasoningStarvation(result) {
		bumped := bumpedMaxTokens(req.Options)
		slog.Warn("openai: streamed empty content with finish_reason=length — retrying with higher max_tokens",
			"provider", p.name, "model", model,
			"orig_max_tokens", req.Options[OptMaxTokens], "new_max_tokens", bumped)
		retry := req
		retry.Options = optionsWithMaxTokens(req.Options, bumped)
		if resp2, err2 := once(retry); err2 == nil && resp2.Content != "" {
			// M3: the FIRST (starved) call's usage is real provider-billed spend
			// (the reasoning tokens it burned) — fold it into the retry's usage so
			// downstream metering isn't blind to the wasted-but-billed call.
			mergeUsageInto(resp2, result.Usage)
			result = resp2
		}
		// Self-heal didn't recover — fall through and return the original empty
		// response so the caller's existing empty-content handling still applies.
	}

	// A6: streamed parity with Chat() — empty "stop" response is an error, not
	// an answer. Safe here: Content=="" means no answer chunk ever reached
	// onChunk, so nothing user-visible is retracted.
	if isEmptyStopResponse(result) {
		return nil, fmt.Errorf("%s: %w", p.name, ErrEmptyResponse)
	}

	// M5: some OpenRouter upstreams omit stream usage entirely even with
	// stream_options.include_usage set → result.Usage stays nil → the caller's
	// billing charges ~0 credits for a real LLM call. Fall back to a
	// conservative chars/4 estimate rather than silently under-billing.
	if result.Usage == nil {
		if est := estimateUsageFallback(req, result); est != nil {
			slog.Warn("openai: stream usage missing — using estimated token fallback for billing",
				"provider", p.name, "model", model,
				"estimated_prompt_tokens", est.PromptTokens, "estimated_completion_tokens", est.CompletionTokens)
			result.Usage = est
		}
	}

	if onChunk != nil {
		onChunk(StreamChunk{Done: true})
	}

	return result, nil
}

// mergeUsageInto adds extra's token counts into dst.Usage (creating it if nil).
// Used by the M3 self-heal paths to fold a starved (but provider-billed) first
// attempt's usage into the successful retry's usage, so metering reflects the
// TOTAL tokens the provider actually charged for across both calls.
func mergeUsageInto(dst *ChatResponse, extra *Usage) {
	if extra == nil {
		return
	}
	if dst.Usage == nil {
		dst.Usage = &Usage{}
	}
	dst.Usage.PromptTokens += extra.PromptTokens
	dst.Usage.CompletionTokens += extra.CompletionTokens
	dst.Usage.TotalTokens += extra.TotalTokens
	dst.Usage.ThinkingTokens += extra.ThinkingTokens
	dst.Usage.CacheReadTokens += extra.CacheReadTokens
	dst.Usage.CacheCreationTokens += extra.CacheCreationTokens
	// Self-heal retries are real billed calls upstream: the starved first attempt
	// is charged even though its output was discarded. Summing keeps the ledger
	// matching the provider invoice instead of hiding the retry's cost.
	dst.Usage.CostUSD += extra.CostUSD
}

// estimateUsageFallback provides a conservative token estimate when a provider
// omits usage data on a streamed response (M5) — without this, resp.Usage stays
// nil and the caller's billing charges ~0 credits for a real LLM call. Uses the
// same chars/4 heuristic as the agent package's EstimateTokens (kept in sync
// manually — providers cannot import the agent package, which imports
// providers, without creating an import cycle). Returns nil when both prompt
// and completion estimate to zero (truly empty request/response — don't
// fabricate a non-zero charge for nothing).
func estimateUsageFallback(req ChatRequest, result *ChatResponse) *Usage {
	promptChars := 0
	for _, m := range req.Messages {
		promptChars += len(m.Content) + len(m.Thinking)
		for _, tc := range m.ToolCalls {
			for _, v := range tc.Arguments {
				promptChars += len(fmt.Sprint(v))
			}
		}
	}
	completionChars := len(result.Content) + len(result.Thinking)
	for _, tc := range result.ToolCalls {
		for _, v := range tc.Arguments {
			completionChars += len(fmt.Sprint(v))
		}
	}
	promptTok := promptChars / 4
	completionTok := completionChars / 4
	if promptTok == 0 && completionTok == 0 {
		return nil
	}
	return &Usage{
		PromptTokens:     promptTok,
		CompletionTokens: completionTok,
		TotalTokens:      promptTok + completionTok,
	}
}

// systemContentWithCacheControl converts a system prompt containing the
// SystemCacheBoundaryMarker into the provider-appropriate content value.
//
// OpenRouter: content-parts array with an explicit Anthropic-style
// cache_control breakpoint on the STATIC prefix part. OpenRouter forwards
// cache_control to caching-capable upstreams (Anthropic, MiMo, …) and strips
// it for the rest; implicit-caching upstreams (OpenAI, DeepSeek) still benefit
// from the stable prefix. Do NOT set provider.order in request options — that
// disables OpenRouter sticky routing and defeats cache affinity.
//
// Every other OpenAI-compatible provider: return the plain string with the
// marker stripped (it was previously sent verbatim — inert but noise), relying
// on the provider's implicit prefix caching.
func (p *OpenAIProvider) systemContentWithCacheControl(content string) interface{} {
	idx := strings.Index(content, SystemCacheBoundaryMarker)
	staticPart := strings.TrimRight(content[:idx], "\n")
	dynamicPart := strings.TrimLeft(content[idx+len(SystemCacheBoundaryMarker):], "\n")

	if p.name != "openrouter" || staticPart == "" {
		return strings.TrimSpace(staticPart + "\n\n" + dynamicPart)
	}

	parts := []map[string]interface{}{{
		"type":          "text",
		"text":          staticPart,
		"cache_control": map[string]interface{}{"type": "ephemeral"},
	}}
	if dynamicPart != "" {
		parts = append(parts, map[string]interface{}{
			"type": "text",
			"text": dynamicPart,
		})
	}
	return parts
}

func (p *OpenAIProvider) buildRequestBody(model string, req ChatRequest, stream bool) map[string]interface{} {
	// Gemini 2.5+: collapse tool_call cycles missing thought_signature.
	// Gemini requires thought_signature echoed back on every tool_call; models that
	// don't return it (e.g. gemini-3-flash) will cause HTTP 400 if sent as-is.
	// Tool results are folded into plain user messages to preserve context.
	inputMessages := req.Messages
	if strings.Contains(strings.ToLower(p.name), "gemini") {
		inputMessages = collapseToolCallsWithoutSig(inputMessages)
	}

	// Convert messages to proper OpenAI wire format.
	// This is necessary because our internal Message/ToolCall structs don't match
	// the OpenAI API format (tool_calls need type+function wrapper, arguments as JSON string).
	// Also omits empty content on assistant messages with tool_calls (Gemini compatibility).
	msgs := make([]map[string]interface{}, 0, len(inputMessages))
	for _, m := range inputMessages {
		msg := map[string]interface{}{
			"role": m.Role,
		}

		// Echo reasoning_content for assistant messages (required by Kimi, DeepSeek when thinking is enabled)
		if m.Thinking != "" && m.Role == "assistant" {
			msg["reasoning_content"] = m.Thinking
		}

		// Include content; omit empty content for assistant messages with tool_calls
		// (Gemini rejects empty content → "must include at least one parts field").
		if m.Role == "user" && len(m.Images) > 0 {
			var parts []map[string]interface{}
			for _, img := range m.Images {
				parts = append(parts, map[string]interface{}{
					"type": "image_url",
					"image_url": map[string]interface{}{
						"url": fmt.Sprintf("data:%s;base64,%s", img.MimeType, img.Data),
					},
				})
			}
			if m.Content != "" {
				parts = append(parts, map[string]interface{}{
					"type": "text",
					"text": m.Content,
				})
			}
			msg["content"] = parts
		} else if m.Role == "system" && strings.Contains(m.Content, SystemCacheBoundaryMarker) {
			msg["content"] = p.systemContentWithCacheControl(m.Content)
		} else if m.Content != "" || len(m.ToolCalls) == 0 {
			msg["content"] = m.Content
		}

		// Convert tool_calls to OpenAI wire format:
		// {id, type: "function", function: {name, arguments: "<json string>"}}
		if len(m.ToolCalls) > 0 {
			toolCalls := make([]map[string]interface{}, len(m.ToolCalls))
			for i, tc := range m.ToolCalls {
				argsJSON, _ := json.Marshal(tc.Arguments)
				fn := map[string]interface{}{
					"name":      tc.Name,
					"arguments": string(argsJSON),
				}
				if sig := tc.Metadata["thought_signature"]; sig != "" {
					fn["thought_signature"] = sig
				}
				toolCalls[i] = map[string]interface{}{
					"id":       tc.ID,
					"type":     "function",
					"function": fn,
				}
			}
			msg["tool_calls"] = toolCalls
		}

		if m.ToolCallID != "" {
			msg["tool_call_id"] = m.ToolCallID
		}

		msgs = append(msgs, msg)
	}

	body := map[string]interface{}{
		"model":    model,
		"messages": msgs,
		"stream":   stream,
	}

	if len(req.Tools) > 0 {
		body["tools"] = CleanToolSchemas(p.name, req.Tools)
		body["tool_choice"] = "auto"
	}

	if stream {
		body["stream_options"] = map[string]interface{}{
			"include_usage": true,
		}
	}

	// Opt into OpenRouter's per-call cost reporting. No-op for every other
	// provider — see openai_openrouter.go.
	p.applyOpenRouterUsageAccounting(body)

	// Merge options
	if v, ok := req.Options[OptMaxTokens]; ok {
		body["max_tokens"] = v
	}
	if v, ok := req.Options[OptTemperature]; ok {
		body["temperature"] = v
	}
	// Anti-repetition sampling — only sent when the caller set it, so no blanket
	// behavior change. frequency_penalty is standard OpenAI; repetition_penalty
	// is passed through for OpenRouter models that honor it.
	if v, ok := req.Options[OptFrequencyPenalty]; ok {
		body["frequency_penalty"] = v
	}
	if v, ok := req.Options[OptRepetitionPenalty]; ok {
		body["repetition_penalty"] = v
	}

	// Forward response_format verbatim when a caller opts in (structured-output
	// adapter / router). Single read covers both the OptResponseFormat const and the
	// literal "response_format" key — same string. Only sent when set, so no blanket
	// behavior change for callers that don't request structured output.
	if v, ok := req.Options[OptResponseFormat]; ok && v != nil {
		body["response_format"] = v
	}

	// Inject reasoning_effort for o-series models (ignored by models that don't support it)
	if level, ok := req.Options[OptThinkingLevel].(string); ok && level != "" && level != "off" {
		body[OptReasoningEffort] = level
	}

	// DashScope-specific passthrough keys
	if v, ok := req.Options[OptEnableThinking]; ok {
		body[OptEnableThinking] = v
	}
	if v, ok := req.Options[OptThinkingBudget]; ok {
		body[OptThinkingBudget] = v
	}

	// Last: strip the fields Google's OpenAI shim refuses to parse. Runs after
	// every other field is set so nothing can add one back — see
	// openai_google_shim.go for why a single unknown field 400s the whole call.
	p.applyGoogleShimCompat(body)
	p.applyStrictSchemaCompat(body)

	return body
}

func (p *OpenAIProvider) doRequest(ctx context.Context, body interface{}) (io.ReadCloser, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("%s: marshal request: %w", p.name, err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", p.apiBase+p.chatPath, bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("%s: create request: %w", p.name, err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+p.apiKey)

	// OpenRouter attribution. Optional for most models, but some upstreams gate
	// access on a declared app identity, and without these the account's traffic
	// is unattributed on OpenRouter's side. Sent only for openrouter so no other
	// OpenAI-compatible endpoint sees headers it never asked for.
	for k, v := range p.extraHeaders {
		httpReq.Header.Set(k, v)
	}
	if p.isOpenRouter() {
		httpReq.Header.Set("HTTP-Referer", openRouterRefererURL)
		httpReq.Header.Set("X-Title", openRouterAppTitle)
	}

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%s: request failed: %w", p.name, err)
	}

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		retryAfter := ParseRetryAfter(resp.Header.Get("Retry-After"))
		return nil, &HTTPError{
			Status:     resp.StatusCode,
			Body:       fmt.Sprintf("%s: %s", p.name, string(respBody)),
			RetryAfter: retryAfter,
		}
	}

	return resp.Body, nil
}

func (p *OpenAIProvider) parseResponse(resp *openAIResponse) *ChatResponse {
	result := &ChatResponse{FinishReason: "stop"}

	if len(resp.Choices) > 0 {
		msg := resp.Choices[0].Message
		result.Content = msg.Content
		result.Thinking = msg.ReasoningContent
		result.FinishReason = resp.Choices[0].FinishReason
		result.RawFinishReason = resp.Choices[0].FinishReason // P01: preserve before the tool_calls overwrite below

		for _, tc := range msg.ToolCalls {
			args, parseErr := parseToolArgs(tc.Function.Arguments)
			call := ToolCall{
				ID:             tc.ID,
				Name:           strings.TrimSpace(tc.Function.Name),
				Arguments:      args,
				RawArguments:   tc.Function.Arguments,
				ArgsParseError: parseErr,
			}
			if tc.Function.ThoughtSignature != "" {
				call.Metadata = map[string]string{"thought_signature": tc.Function.ThoughtSignature}
			}
			result.ToolCalls = append(result.ToolCalls, call)
		}

		if len(result.ToolCalls) > 0 {
			result.FinishReason = "tool_calls"
		}
	}

	if resp.Usage != nil {
		result.Usage = resp.Usage.toUsage(p.isOpenRouter())
	}

	return result
}
