package providers

import (
	"encoding/json"
	"strings"
)

// SystemCacheBoundaryMarker delimits the CACHEABLE static prefix of the agent
// system prompt (identity, tooling, skills, safety, project context, etc.) from
// its per-turn dynamic tail (workspace state snapshot, current time). Emitted as
// a plain line within the composed system prompt by agent.BuildSystemPrompt (C2
// fix); buildRequestBody below splits on it so the Anthropic cache_control
// breakpoint lands on the STATIC block only — never on content that changes
// every turn or every minute, which would otherwise write a fresh (never-read)
// cache entry on nearly every call. Other providers (OpenAI-compat) simply see
// an inert text line — the system prompt is never echoed back to the end user.
const SystemCacheBoundaryMarker = "<!--anytools:cache-boundary-->"

// buildRawBlock reconstructs a complete content block from streaming data.
// This is needed to preserve thinking blocks (with signatures) for tool use passback.
func (p *AnthropicProvider) buildRawBlock(blockType string, result *ChatResponse, toolCallJSON map[int]string, _ int) json.RawMessage {
	switch blockType {
	case "thinking":
		block := map[string]interface{}{
			"type":     "thinking",
			"thinking": result.Thinking,
		}
		if b, err := json.Marshal(block); err == nil {
			return b
		}
	case "text":
		block := map[string]interface{}{
			"type": "text",
			"text": result.Content,
		}
		if b, err := json.Marshal(block); err == nil {
			return b
		}
	case "tool_use":
		if len(result.ToolCalls) > 0 {
			tc := result.ToolCalls[len(result.ToolCalls)-1]
			// Parse accumulated JSON for this tool call
			args := make(map[string]interface{})
			for i, rawJSON := range toolCallJSON {
				if i == len(result.ToolCalls)-1 && rawJSON != "" {
					// Parse error tolerated here: this only rebuilds the passback
					// block (Anthropic requires an object); the matching ToolCall
					// carries ArgsParseError and the loop blocks dispatch.
					args, _ = parseToolArgs(rawJSON)
				}
			}
			block := map[string]interface{}{
				"type":  "tool_use",
				"id":    tc.ID,
				"name":  tc.Name,
				"input": args,
			}
			if b, err := json.Marshal(block); err == nil {
				return b
			}
		}
	case "redacted_thinking":
		// Pass through as-is (we don't have the encrypted data in streaming)
		block := map[string]interface{}{
			"type": "redacted_thinking",
		}
		if b, err := json.Marshal(block); err == nil {
			return b
		}
	}
	return nil
}

func (p *AnthropicProvider) buildRequestBody(model string, req ChatRequest, stream bool) map[string]interface{} {
	// Separate system messages and build conversation messages
	var systemBlocks []map[string]interface{}
	var messages []map[string]interface{}

	// staticSystemBlockIdx tracks the index (into systemBlocks) of the last
	// STATIC/cacheable system block — the one the ephemeral cache_control
	// breakpoint below actually belongs on (C2). -1 = none seen yet (falls back
	// to "last block" for legacy callers that don't emit the boundary marker,
	// e.g. the compaction/summarizer system-less prompts).
	staticSystemBlockIdx := -1

	for _, msg := range req.Messages {
		switch msg.Role {
		case "system":
			// C2: split on the agent-emitted cache boundary marker so the
			// cache_control breakpoint lands on the STATIC prefix, not on the
			// per-turn dynamic tail (workspace snapshot + time) that follows it.
			// A minute-granular/per-turn-varying block marked as the cache
			// breakpoint would write a fresh (never-read) cache entry almost
			// every call — the exact bug this fix addresses.
			if idx := strings.Index(msg.Content, SystemCacheBoundaryMarker); idx >= 0 {
				staticPart := strings.TrimRight(msg.Content[:idx], "\n")
				dynamicPart := strings.TrimLeft(msg.Content[idx+len(SystemCacheBoundaryMarker):], "\n")
				if staticPart != "" {
					systemBlocks = append(systemBlocks, map[string]interface{}{
						"type": "text",
						"text": staticPart,
					})
					staticSystemBlockIdx = len(systemBlocks) - 1
				}
				if dynamicPart != "" {
					systemBlocks = append(systemBlocks, map[string]interface{}{
						"type": "text",
						"text": dynamicPart,
					})
				}
				continue
			}
			systemBlocks = append(systemBlocks, map[string]interface{}{
				"type": "text",
				"text": msg.Content,
			})
			// No marker (e.g. a bare summarizer/compaction prompt): treat the
			// whole thing as cacheable, matching the pre-C2 behavior.
			staticSystemBlockIdx = len(systemBlocks) - 1

		case "user":
			if len(msg.Images) > 0 {
				var blocks []map[string]interface{}
				for _, img := range msg.Images {
					blocks = append(blocks, map[string]interface{}{
						"type": "image",
						"source": map[string]interface{}{
							"type":       "base64",
							"media_type": img.MimeType,
							"data":       img.Data,
						},
					})
				}
				if msg.Content != "" {
					blocks = append(blocks, map[string]interface{}{
						"type": "text",
						"text": msg.Content,
					})
				}
				messages = append(messages, map[string]interface{}{
					"role":    "user",
					"content": blocks,
				})
			} else {
				messages = append(messages, map[string]interface{}{
					"role":    "user",
					"content": msg.Content,
				})
			}

		case "assistant":
			// If we have raw content blocks (from Anthropic thinking), use them directly
			// to preserve thinking blocks + signatures for tool use passback.
			if msg.RawAssistantContent != nil {
				var rawBlocks []json.RawMessage
				if json.Unmarshal(msg.RawAssistantContent, &rawBlocks) == nil && len(rawBlocks) > 0 {
					messages = append(messages, map[string]interface{}{
						"role":    "assistant",
						"content": rawBlocks,
					})
					continue
				}
			}

			var blocks []map[string]interface{}
			if msg.Content != "" {
				blocks = append(blocks, map[string]interface{}{
					"type": "text",
					"text": msg.Content,
				})
			}
			for _, tc := range msg.ToolCalls {
				blocks = append(blocks, map[string]interface{}{
					"type":  "tool_use",
					"id":    tc.ID,
					"name":  tc.Name,
					"input": tc.Arguments,
				})
			}
			messages = append(messages, map[string]interface{}{
				"role":    "assistant",
				"content": blocks,
			})

		case "tool":
			messages = append(messages, map[string]interface{}{
				"role": "user",
				"content": []map[string]interface{}{
					{
						"type":        "tool_result",
						"tool_use_id": msg.ToolCallID,
						"content":     msg.Content,
					},
				},
			})
		}
	}

	body := map[string]interface{}{
		"model":      model,
		"max_tokens": 4096,
		"messages":   messages,
	}

	if stream {
		body["stream"] = true
	}

	if len(systemBlocks) > 0 {
		// Prompt caching: mark the STATIC system block as the cache breakpoint
		// (C2). Anthropic caches the prefix in tools→system→messages order, so
		// this breakpoint caches the full static prefix (tools + static system
		// text), letting multi-turn agent runs skip re-billing/re-processing it
		// — regardless of whether a per-turn dynamic tail block follows it.
		// (A top-level "cache_control" field is NOT valid API and is ignored.)
		idx := staticSystemBlockIdx
		if idx < 0 || idx >= len(systemBlocks) {
			idx = len(systemBlocks) - 1
		}
		systemBlocks[idx]["cache_control"] = map[string]interface{}{"type": "ephemeral"}
		body["system"] = systemBlocks
	}

	// C2: second cache breakpoint on the last conversation message. Combined
	// with the static-prefix breakpoint above, an ongoing multi-turn
	// conversation caches incrementally — only the newest turn's tokens are
	// billed at full price instead of the whole growing history every call.
	addCacheBreakpointToLastMessage(messages)

	// Translate tools to Anthropic format
	if len(req.Tools) > 0 {
		var tools []map[string]interface{}
		for _, t := range req.Tools {
			cleanedParams := CleanSchemaForProvider("anthropic", t.Function.Parameters)
			tool := map[string]interface{}{
				"name":         t.Function.Name,
				"description":  t.Function.Description,
				"input_schema": cleanedParams,
			}
			tools = append(tools, tool)
		}
		// When there is no system block to anchor the cache breakpoint, cache the
		// tools prefix directly (last tool marks the boundary).
		if len(systemBlocks) == 0 && len(tools) > 0 {
			tools[len(tools)-1]["cache_control"] = map[string]interface{}{"type": "ephemeral"}
		}
		body["tools"] = tools
	}

	// Merge options
	if v, ok := req.Options[OptMaxTokens]; ok {
		body["max_tokens"] = v
	}
	if v, ok := req.Options[OptTemperature]; ok {
		body["temperature"] = v
	}

	// Enable extended thinking if thinking_level is set
	if level, ok := req.Options[OptThinkingLevel].(string); ok && level != "" && level != "off" {
		budget := anthropicThinkingBudget(level)
		body["thinking"] = map[string]interface{}{
			"type":          "enabled",
			"budget_tokens": budget,
		}
		// Anthropic requires no temperature when thinking is enabled
		delete(body, "temperature")
		// Ensure max_tokens accommodates thinking budget + response
		if maxTok, ok := body["max_tokens"].(int); !ok || maxTok < budget+4096 {
			body["max_tokens"] = budget + 8192
		}
	}

	// Subscription-OAuth request shaping (system-block injection, metadata,
	// sampling strip). No-op for API-key mode. Done LAST so it sees the final
	// system/tools/thinking shape.
	p.applyOAuthShape(body, p.oauthSessionID)

	return body
}

// addCacheBreakpointToLastMessage marks the last message's final content block
// with an Anthropic ephemeral cache_control breakpoint (C2's second breakpoint)
// so an ongoing conversation's PRIOR turns become incrementally cacheable — only
// the newest turn is billed at full price. Mutates messages' map elements in
// place (maps/slices are reference types, so this is visible through any other
// reference to the same backing array/maps, e.g. body["messages"]).
//
// Anthropic requires cache_control on a content BLOCK, not the message
// wrapper, so a plain string content is first promoted to a one-block text
// array. Safe no-op for content shapes this function doesn't recognise (e.g.
// raw passthrough thinking blocks from RawAssistantContent) — caching is an
// optimization, never a correctness requirement, and Anthropic silently ignores
// cache_control below its minimum cacheable token threshold rather than erroring.
func addCacheBreakpointToLastMessage(messages []map[string]interface{}) {
	if len(messages) == 0 {
		return
	}
	last := messages[len(messages)-1]
	switch content := last["content"].(type) {
	case string:
		if content == "" {
			return
		}
		last["content"] = []map[string]interface{}{
			{"type": "text", "text": content, "cache_control": map[string]interface{}{"type": "ephemeral"}},
		}
	case []map[string]interface{}:
		if len(content) == 0 {
			return
		}
		content[len(content)-1]["cache_control"] = map[string]interface{}{"type": "ephemeral"}
	default:
		// Unrecognized content shape (e.g. []json.RawMessage passthrough) — skip.
	}
}

// anthropicThinkingBudget maps a thinking level to a token budget.
func anthropicThinkingBudget(level string) int {
	switch level {
	case "low":
		return 4096
	case "medium":
		return 10000
	case "high":
		return 32000
	default:
		return 10000
	}
}
