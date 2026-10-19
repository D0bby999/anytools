package chat

import (
	"strings"
	"unicode/utf8"

	"github.com/D0bby999/anytools/internal/runtime"
)

// context_window.go sizes a turn's prompt against the model that will read it.
//
// The table is postclaw's (internal/agent/model_context_window.go): substrings
// of the lowercased model id, most specific first, the provider-advertised
// window. A model that is not in it gets defaultContextWindow, which is far
// smaller than postclaw's 200k on purpose: AnyTools is BYOK, and the unknown
// models here are mostly self-hosted ones (Ollama's default context is a few
// thousand tokens), where assuming a large window means a prompt the server
// silently cuts from the front.

// defaultContextWindow is the window assumed for a model the table does not
// know.
const defaultContextWindow = 32_768

var modelContextWindow = []struct {
	match  string
	window int
}{
	{"gemini-1.5", 1_048_576},
	{"gemini-2", 1_048_576},
	{"gemini-3", 1_048_576},
	{"gemini", 1_048_576},
	{"gpt-4.1", 1_047_576},
	{"gpt-5", 400_000},
	{"gpt-4o", 128_000},
	{"deepseek", 163_840},
	{"minimax", 1_000_000},
	{"mimo", 1_048_576},
	{"llama-3", 131_072},
	{"llama3", 131_072},
	{"qwen", 262_144},
	{"grok-4", 256_000},
	{"grok", 131_072},
	{"mistral", 131_072},
	{"glm", 200_000},
	{"kimi", 131_072},
	{"claude", 200_000},
	{"o1", 200_000},
	{"o3", 200_000},
	{"o4", 200_000},
}

// contextWindow returns the window for a model id. A provider prefix
// ("openai/gpt-4o") is tolerated: matching is by substring.
func contextWindow(model string) int {
	id := strings.ToLower(strings.TrimSpace(model))
	if id == "" {
		return defaultContextWindow
	}
	for _, e := range modelContextWindow {
		if strings.Contains(id, e.match) {
			return e.window
		}
	}
	return defaultContextWindow
}

// History budget, in tokens.
//
// historyShare of the window goes to earlier messages; the rest is the system
// prompt, this turn's tool output and the answer. historyCeiling clamps it
// for large windows, postclaw's H1 lesson: a 1M-token model never reaches a
// share-based threshold, so every turn re-sent the whole conversation on the
// user's own key.
//
// When the history no longer fits, it is cut back to compactTarget of the
// budget rather than to the budget itself, so the next few turns have room to
// grow before another summary call is needed (postclaw compaction_target.go).
const (
	historyShare   = 0.5
	historyCeiling = 24_000
	compactTarget  = 0.6
)

func historyBudget(window int) int {
	b := int(float64(window) * historyShare)
	if b > historyCeiling {
		b = historyCeiling
	}
	return b
}

// estimateTokens is a deliberately pessimistic count: one token per three
// characters. English averages nearer four, but Vietnamese with its diacritics
// and CJK run closer to two or three, and under-counting is the error that
// overflows a window.
func estimateTokens(s string) int {
	return utf8.RuneCountInString(s)/3 + 1
}

// messageTokens adds a fixed per-message overhead for the role and framing.
func messageTokens(m runtime.Message) int {
	n := estimateTokens(m.Content) + 4
	for _, call := range m.ToolCalls {
		n += estimateTokens(call.Name) + estimateTokens(call.RawArguments) + 8
		if call.RawArguments == "" {
			n += 16
		}
	}
	return n
}

func promptTokens(msgs []runtime.Message) int {
	n := 0
	for _, m := range msgs {
		n += messageTokens(m)
	}
	return n
}
