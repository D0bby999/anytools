package providers

import (
	"errors"
	"regexp"
	"strings"
)

// error_classify.go — provider error classification beyond retryability.
//
// IsRetryableError (retry.go) answers "will the same request succeed later?"
// (429/5xx/network). This file answers a different question: "did the request
// fail because the PROMPT no longer fits the model's context window?" — an
// error that is permanent for the same payload but recoverable by compacting
// the conversation and retrying (see the overflow branch in
// internal/agent/loop.go). Matching the dsh design: adapters classify, the
// loop recovers.
//
// Classification is deliberately conservative: a 400 misread as overflow
// triggers a useless compact+retry cycle, so every signature below must match
// a documented/observed provider message. When in doubt, do not match.

// ErrStreamClosed marks a streaming response whose connection ended cleanly
// BEFORE the provider signalled completion ("[DONE]" for SSE). The partial
// content already read must not be treated as a complete answer — a proxy or
// gateway closing the connection mid-generation would otherwise silently
// truncate replies. Retryable: the attempt produced nothing durable.
var ErrStreamClosed = errors.New("stream closed before completion")

// ErrEmptyResponse marks a response with no content, no thinking, and no tool
// calls despite a normal finish_reason="stop". Appending such an assistant
// message to history is worse than useless (some gateways 400 on empty
// assistant content). Retryable: usually a transient upstream glitch.
// Distinct from reasoning starvation (finish_reason="length"), which has its
// own self-heal in openai.go.
var ErrEmptyResponse = errors.New("provider returned empty response")

// IsStreamClosed reports whether err is (or wraps) ErrStreamClosed.
func IsStreamClosed(err error) bool { return errors.Is(err, ErrStreamClosed) }

// IsEmptyResponse reports whether err is (or wraps) ErrEmptyResponse.
func IsEmptyResponse(err error) bool { return errors.Is(err, ErrEmptyResponse) }

// overflowBodyRe matches context-window-exceeded messages across providers:
//   - OpenAI/DeepSeek/OpenRouter (OpenAI-compat): code "context_length_exceeded",
//     "This model's maximum context length is 128000 tokens"
//   - Anthropic: "prompt is too long: 214421 tokens > 200000 maximum"
//   - Gemini (OpenAI-compat surface): "input token count exceeds the maximum"
//   - Mistral: "too large for model with 32768 maximum context length"
//   - Generic gateways: "context window exceeded", "exceeds the context window"
var overflowBodyRe = regexp.MustCompile(strings.Join([]string{
	`context_length_exceeded`,
	`maximum context length`,
	`maximum prompt length`,
	`prompt is too long`,
	`input token count exceeds`,
	`exceeds? the (model'?s? )?(maximum )?(context|token)`,
	`context window (is )?exceeded`,
	`too many (input )?tokens`,
	`input is too long`,
}, "|"))

// overflowStatusOK limits body matching to statuses providers actually use for
// an oversized prompt. 5xx/429 bodies sometimes echo request details and must
// never classify as overflow — those are retry.go's domain.
func overflowStatusOK(status int) bool {
	switch status {
	case 400, 413, 422:
		return true
	}
	return false
}

// IsContextOverflow reports whether err is a provider rejection caused by the
// prompt exceeding the model's context window. Callers may recover by
// shrinking the conversation and retrying the SAME request once or twice —
// never by blind resubmission.
func IsContextOverflow(err error) bool {
	if err == nil {
		return false
	}
	var httpErr *HTTPError
	if errors.As(err, &httpErr) {
		return overflowStatusOK(httpErr.Status) && overflowBodyRe.MatchString(strings.ToLower(httpErr.Body))
	}
	// Non-HTTP wraps (SDK-mapped errors, CLI providers): require a strong
	// signature in the message itself; plain "token" mentions do not count.
	return overflowBodyRe.MatchString(strings.ToLower(err.Error()))
}
