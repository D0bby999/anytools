package providers

import (
	"context"
	"encoding/json"
)

// Options keys used in ChatRequest.Options across providers.
const (
	OptMaxTokens       = "max_tokens"
	OptTemperature     = "temperature"
	OptThinkingLevel   = "thinking_level"
	OptReasoningEffort = "reasoning_effort"
	OptEnableThinking  = "enable_thinking"
	OptThinkingBudget  = "thinking_budget"
	// OptResponseFormat carries an OpenAI-compatible response_format value, e.g.
	// {"type":"json_object"} or {"type":"json_schema","json_schema":{...}}.
	// Forwarded verbatim by the OpenAI-compatible client when a caller sets it.
	OptResponseFormat = "response_format"
	// OptFrequencyPenalty / OptRepetitionPenalty carry OpenAI-compatible
	// anti-repetition sampling params (frequency_penalty additive [-2,2];
	// repetition_penalty multiplicative, model-specific — OpenRouter passes it
	// through). Only forwarded when set. They exist because a degenerate
	// repetition loop can otherwise stream a turn to its max-token ceiling
	// without ever terminating.
	OptFrequencyPenalty  = "frequency_penalty"
	OptRepetitionPenalty = "repetition_penalty"
)

// TokenSource provides an OAuth access token (with auto-refresh).
type TokenSource interface {
	Token() (string, error)
}

// StaticToken is a TokenSource returning a fixed token, for a caller that has
// already resolved one.
type StaticToken string

func (s StaticToken) Token() (string, error) { return string(s), nil }

// Provider is the interface all LLM providers must implement.
type Provider interface {
	// Chat sends messages to the LLM and returns a response.
	// tools defines available tool schemas; model overrides the default.
	Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error)

	// ChatStream sends messages and streams response chunks via callback.
	// Returns the final complete response after streaming ends.
	ChatStream(ctx context.Context, req ChatRequest, onChunk func(StreamChunk)) (*ChatResponse, error)

	// DefaultModel returns the provider's default model name.
	DefaultModel() string

	// Name returns the provider identifier (e.g. "anthropic", "openai").
	Name() string
}

// ThinkingCapable is optionally implemented by providers that support extended thinking.
// Used to gate thinking_level injection so it's not sent to providers that ignore it.
type ThinkingCapable interface {
	SupportsThinking() bool
}

// ChatRequest contains the input for a Chat/ChatStream call.
type ChatRequest struct {
	Messages []Message              `json:"messages"`
	Tools    []ToolDefinition       `json:"tools,omitempty"`
	Model    string                 `json:"model,omitempty"`
	Options  map[string]interface{} `json:"options,omitempty"`
}

// ChatResponse is the result from an LLM call.
type ChatResponse struct {
	Content      string     `json:"content"`
	Thinking     string     `json:"thinking,omitempty"`
	ToolCalls    []ToolCall `json:"tool_calls,omitempty"`
	FinishReason string     `json:"finish_reason"` // "stop", "tool_calls", "length"

	// RawFinishReason preserves the provider's ORIGINAL finish/stop reason before any
	// normalization. FinishReason is overwritten to "tool_calls" whenever tool calls are
	// present, which hides safety/refusal signals (OpenAI content_filter, Anthropic refusal,
	// Gemini SAFETY) that can accompany truncated tool calls. Callers that must distinguish
	// a safety termination from a normal tool turn read this. Empty when the provider
	// doesn't surface a distinct raw reason.
	RawFinishReason string `json:"raw_finish_reason,omitempty"`
	Usage           *Usage `json:"usage,omitempty"`

	// Phase is Codex-specific (gpt-5.3-codex): "commentary" or "final_answer".
	// Agent loop must persist this on assistant messages for Codex performance.
	Phase string `json:"phase,omitempty"`

	// RawAssistantContent preserves the raw content blocks array from the provider response.
	// Used by Anthropic to pass thinking blocks back in tool use loops (required by API).
	RawAssistantContent json.RawMessage `json:"-"`
}

// StreamChunk is a piece of a streaming response.
type StreamChunk struct {
	Content  string `json:"content,omitempty"`
	Thinking string `json:"thinking,omitempty"`
	Done     bool   `json:"done,omitempty"`
}

// ImageContent represents a base64-encoded image for vision-capable models.
type ImageContent struct {
	MimeType string `json:"mime_type"` // e.g. "image/jpeg"
	Data     string `json:"data"`      // base64-encoded image bytes
}

// Message represents a conversation message.
type Message struct {
	Role       string         `json:"role"` // "system", "user", "assistant", "tool"
	Content    string         `json:"content"`
	Thinking   string         `json:"thinking,omitempty"` // reasoning_content for thinking models (Kimi, DeepSeek, etc.)
	Images     []ImageContent `json:"images,omitempty"`   // vision: base64 images (runtime only, not persisted)
	ToolCalls  []ToolCall     `json:"tool_calls,omitempty"`
	ToolCallID string         `json:"tool_call_id,omitempty"` // for role="tool" responses

	// Phase is a Codex-specific field (gpt-5.3-codex) indicating message purpose.
	// Values: "commentary" (intermediate), "final_answer" (closeout), or "" (unset).
	// Must be persisted and passed back in subsequent requests for Codex performance.
	// Other providers ignore this field.
	Phase string `json:"phase,omitempty"`

	// CreatedAt is the Unix millisecond timestamp when this message was created.
	CreatedAt int64 `json:"created_at,omitempty"`

	// RawAssistantContent carries raw provider content blocks through tool loop iterations.
	// Anthropic requires thinking blocks to be passed back exactly as received.
	RawAssistantContent json.RawMessage `json:"-"`
}

// ToolCall represents a tool invocation requested by the LLM.
type ToolCall struct {
	ID        string                 `json:"id"`
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments"`
	Metadata  map[string]string      `json:"metadata,omitempty"` // provider-specific (e.g. Gemini thought_signature)
	// RawArguments preserves the provider's argument JSON exactly as received.
	// When that JSON fails to parse, ArgsParseError carries the parse error and
	// Arguments is an empty map — the agent loop must NOT dispatch such a call
	// (it would execute with zero arguments); it returns the error to the model
	// instead so the model can re-issue valid JSON.
	RawArguments   string `json:"raw_arguments,omitempty"`
	ArgsParseError string `json:"args_parse_error,omitempty"`
}

// ToolDefinition describes a tool available to the LLM.
type ToolDefinition struct {
	Type     string             `json:"type"` // "function"
	Function ToolFunctionSchema `json:"function"`
}

// ToolFunctionSchema is the schema for a function tool.
type ToolFunctionSchema struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Parameters  map[string]interface{} `json:"parameters"`
}

// Usage tracks token consumption.
//
// PromptTokens holds NON-CACHED input tokens only (Anthropic semantics:
// input_tokens excludes cache reads). OpenAI-compatible providers report
// prompt_tokens INCLUSIVE of cached tokens, so the openai.go parser subtracts
// prompt_tokens_details.cached_tokens at ingestion. Total context size =
// PromptTokens + CacheReadTokens.
type Usage struct {
	PromptTokens        int `json:"prompt_tokens"`
	CompletionTokens    int `json:"completion_tokens"`
	TotalTokens         int `json:"total_tokens"`
	CacheCreationTokens int `json:"cache_creation_input_tokens,omitempty"`
	CacheReadTokens     int `json:"cache_read_input_tokens,omitempty"`
	ThinkingTokens      int `json:"thinking_tokens,omitempty"`

	// CostUSD is what the provider says this one call cost, when it says so at
	// all — only OpenRouter does, via `usage: {include: true}`.
	//
	// AnyTools does not bill: it is free and BYOK, and this is the USER's own
	// spend on their own account. It is carried because it is the only honest
	// per-call number available (the provider computed it against the upstream
	// that actually served the request, so it reflects routing and cache hits a
	// local price table cannot), and a later surface that shows a user what
	// their own key is spending should read it rather than re-derive it. Zero
	// means "not reported", never "free".
	CostUSD float64 `json:"cost_usd,omitempty"`
}
