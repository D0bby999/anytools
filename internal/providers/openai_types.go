package providers

// OpenAI API response types (internal)

type openAIResponse struct {
	Choices []openAIChoice `json:"choices"`
	Usage   *openAIUsage   `json:"usage,omitempty"`
}

type openAIChoice struct {
	Message      openAIMessage `json:"message"`
	FinishReason string        `json:"finish_reason"`
}

type openAIMessage struct {
	Role             string           `json:"role"`
	Content          string           `json:"content"`
	ReasoningContent string           `json:"reasoning_content,omitempty"`
	ToolCalls        []openAIToolCall `json:"tool_calls,omitempty"`
}

type openAIToolCall struct {
	ID       string             `json:"id"`
	Type     string             `json:"type"`
	Function openAIFunctionCall `json:"function"`
}

type openAIFunctionCall struct {
	Name             string `json:"name"`
	Arguments        string `json:"arguments"`
	ThoughtSignature string `json:"thought_signature,omitempty"` // Gemini 2.5/3: must echo back
}

type openAIUsage struct {
	PromptTokens            int                      `json:"prompt_tokens"`
	CompletionTokens        int                      `json:"completion_tokens"`
	TotalTokens             int                      `json:"total_tokens"`
	PromptTokensDetails     *openAIPromptDetails     `json:"prompt_tokens_details,omitempty"`
	CompletionTokensDetails *openAICompletionDetails `json:"completion_tokens_details,omitempty"`

	// Cost is OpenRouter-specific and only present when the request opted in via
	// `usage: {include: true}` (openai_openrouter.go). USD for this single call,
	// computed by OpenRouter against whichever upstream actually served it — so
	// it already accounts for routing, cache hits and tiered pricing. Absent
	// (zero) for every other OpenAI-compatible provider.
	Cost float64 `json:"cost,omitempty"`

	// CostDetails carries OpenRouter's breakdown. For a normal (credits-based)
	// OpenRouter account Cost IS the spend and this is absent. For a
	// provider-key / BYOK-to-OpenRouter integration, Cost is only OpenRouter's
	// own fee (~5%) and the real model spend lands in UpstreamInferenceCost —
	// billing on Cost alone would then under-charge ~20x. Summing both is
	// correct in either configuration because the unused field is zero.
	CostDetails *openAICostDetails `json:"cost_details,omitempty"`
}

type openAICostDetails struct {
	UpstreamInferenceCost float64 `json:"upstream_inference_cost,omitempty"`
}

type openAIPromptDetails struct {
	CachedTokens int `json:"cached_tokens"`
	// CacheWriteTokens is OpenRouter-specific (Anthropic-style upstreams):
	// tokens written to cache on this request, billed at the write surcharge.
	CacheWriteTokens int `json:"cache_write_tokens,omitempty"`
}

type openAICompletionDetails struct {
	ReasoningTokens int `json:"reasoning_tokens"`
}

// Streaming types

type openAIStreamChunk struct {
	Choices []openAIStreamChoice `json:"choices"`
	Usage   *openAIUsage         `json:"usage,omitempty"`
}

type openAIStreamChoice struct {
	Delta        openAIStreamDelta `json:"delta"`
	FinishReason string            `json:"finish_reason,omitempty"`
}

type openAIStreamDelta struct {
	Content          string                 `json:"content,omitempty"`
	ReasoningContent string                 `json:"reasoning_content,omitempty"`
	ToolCalls        []openAIStreamToolCall `json:"tool_calls,omitempty"`
}

type openAIStreamToolCall struct {
	Index    int                `json:"index"`
	ID       string             `json:"id,omitempty"`
	Function openAIFunctionCall `json:"function"`
}

// totalCostUSD is what this call actually cost us: OpenRouter's own charge plus
// any upstream inference cost reported separately. See CostDetails.
func (u *openAIUsage) totalCostUSD() float64 {
	total := u.Cost
	if u.CostDetails != nil {
		total += u.CostDetails.UpstreamInferenceCost
	}
	return total
}

// toUsage converts a provider usage object into the canonical Usage.
//
// Single conversion point for BOTH the streamed (final usage chunk) and
// non-streamed response paths — they previously carried byte-identical copies
// of this logic, so any fix had to be applied twice or silently diverged.
// Returns nil for nil input so callers can assign straight through.
// trustCost gates the reported price: only an endpoint we know to be OpenRouter
// may set CostUSD. A BYOK api_base points wherever the user says, and CostUSD
// feeds billing directly, so a forged `cost` from an arbitrary endpoint must not
// be able to reach the ledger. BYOK runs are not charged today (loop_run.go
// skips metering when OverrideProvider is set), but that is a guarantee made in
// a distant file; this keeps the property local to where the value is created.
func (u *openAIUsage) toUsage(trustCost bool) *Usage {
	if u == nil {
		return nil
	}

	out := &Usage{
		PromptTokens:     u.PromptTokens,
		CompletionTokens: u.CompletionTokens,
		TotalTokens:      u.TotalTokens,
	}
	if trustCost {
		out.CostUSD = u.totalCostUSD()
	}

	if u.PromptTokensDetails != nil {
		out.CacheReadTokens = u.PromptTokensDetails.CachedTokens
		out.CacheCreationTokens = u.PromptTokensDetails.CacheWriteTokens
		// OpenAI counts cached tokens INSIDE prompt_tokens; our Usage contract
		// keeps them separate (see types.go). Subtract so billing prices cache
		// reads at the discount, not 110%.
		if out.CacheReadTokens > 0 && out.PromptTokens >= out.CacheReadTokens {
			out.PromptTokens -= out.CacheReadTokens
		}
	}

	if u.CompletionTokensDetails != nil && u.CompletionTokensDetails.ReasoningTokens > 0 {
		out.ThinkingTokens = u.CompletionTokensDetails.ReasoningTokens
	}

	return out
}

// toolCallAccumulator extends ToolCall with temporary fields for accumulating
// streamed arguments and thought_signature during SSE streaming.
type toolCallAccumulator struct {
	ToolCall
	rawArgs    string
	thoughtSig string
}
