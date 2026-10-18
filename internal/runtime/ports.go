package runtime

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
)

// ports.go holds the CONSUMER-SIDE interfaces this package needs from
// subsystems built in other phases, plus the provider DTOs those interfaces
// speak in.
//
// Why the DTOs are copied rather than imported: phase 4 ports postclaw's
// `internal/providers` unchanged (scout §3 — `Provider{Chat, ChatStream,
// DefaultModel, Name}` at internal/providers/types.go:43, `ChatRequest` :66,
// `ChatResponse` :74, `StreamChunk` :99, `Message` :133, `ToolCall` :170,
// `ToolDefinition` :185, `Usage` :205) and is being built on another branch at
// the same time as this one. The definitions below are those shapes, narrowed
// to the fields a turn actually uses. At merge, `internal/byok` supplies a
// ChatProviderResolver whose ChatFor returns an adapter over the real
// providers.Provider; the adapter is the only code that has to know both
// spellings. See the merge note at the end of this file for the exact list.

// ChatProviderResolver hands a turn the provider the user configured for a
// given function ("chat", "quiz", ...).
//
// It is a per-turn lookup rather than a construction-time dependency because a
// user can rotate a key or switch provider between two turns of the same
// session, and the turn row records which provider actually served it (AC3).
type ChatProviderResolver interface {
	ChatFor(ctx context.Context, userID uuid.UUID, function string) (ChatProvider, error)
}

// ErrNoProvider is what a resolver returns when the user has configured no
// usable provider for the function. It is a user-fixable state (paste a key in
// Settings), not a server fault, so the turn fails with NO_PROVIDER and is not
// retryable.
var ErrNoProvider = errors.New("no chat provider configured")

// ChatProvider mirrors postclaw's providers.Provider (types.go:43).
type ChatProvider interface {
	Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error)
	ChatStream(ctx context.Context, req ChatRequest, onChunk func(StreamChunk)) (*ChatResponse, error)
	DefaultModel() string
	Name() string
}

// ChatRequest mirrors providers.ChatRequest (types.go:66).
type ChatRequest struct {
	Messages []Message        `json:"messages"`
	Tools    []ToolDefinition `json:"tools,omitempty"`
	Model    string           `json:"model,omitempty"`
	Options  map[string]any   `json:"options,omitempty"`
}

// ChatResponse mirrors providers.ChatResponse (types.go:74), narrowed to the
// fields a turn reads. RawFinishReason is kept because postclaw learned that
// FinishReason is overwritten to "tool_calls" whenever tool calls are present,
// which hides a safety/refusal termination behind what looks like a normal
// tool round.
type ChatResponse struct {
	Content         string     `json:"content"`
	Thinking        string     `json:"thinking,omitempty"`
	ToolCalls       []ToolCall `json:"tool_calls,omitempty"`
	FinishReason    string     `json:"finish_reason"`
	RawFinishReason string     `json:"raw_finish_reason,omitempty"`
	Usage           *Usage     `json:"usage,omitempty"`
}

// StreamChunk mirrors providers.StreamChunk (types.go:99).
type StreamChunk struct {
	Content  string `json:"content,omitempty"`
	Thinking string `json:"thinking,omitempty"`
	Done     bool   `json:"done,omitempty"`
}

// Message mirrors providers.Message (types.go:133), narrowed: no media refs,
// no Codex phase. A grounded chat turn sends text and tool results; phase 9's
// solve adds Images, the one field it needed back.
type Message struct {
	Role     string `json:"role"` // "system", "user", "assistant", "tool"
	Content  string `json:"content"`
	Thinking string `json:"thinking,omitempty"`
	// Images ride on a USER message only — that is the one role every
	// vision-capable wire format accepts them on. They are runtime-only: the
	// transcript stores what was attached, never the bytes.
	Images     []Image    `json:"images,omitempty"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

// Image mirrors providers.ImageContent: a base64-encoded image for a
// vision-capable model.
type Image struct {
	MimeType string `json:"mime_type"` // image/png, image/jpeg, image/webp, image/gif
	Data     string `json:"data"`      // base64, standard encoding, no data: prefix
}

// ToolCall mirrors providers.ToolCall (types.go:170).
//
// ArgsParseError is load-bearing: postclaw's note says a call whose argument
// JSON failed to parse must NOT be dispatched, because Arguments is then an
// empty map and the tool would run with zero arguments — for `rag_search` that
// is a search with no kb_ids, and for anything destructive it is worse. The
// orchestrator returns the parse error to the model instead.
type ToolCall struct {
	ID             string         `json:"id"`
	Name           string         `json:"name"`
	Arguments      map[string]any `json:"arguments"`
	RawArguments   string         `json:"raw_arguments,omitempty"`
	ArgsParseError string         `json:"args_parse_error,omitempty"`
}

// ToolDefinition mirrors providers.ToolDefinition (types.go:185).
type ToolDefinition struct {
	Type     string             `json:"type"` // always "function"
	Function ToolFunctionSchema `json:"function"`
}

// ToolFunctionSchema mirrors providers.ToolFunctionSchema.
type ToolFunctionSchema struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

// Usage mirrors providers.Usage (types.go:205). PromptTokens excludes cache
// reads; total context = PromptTokens + CacheReadTokens.
type Usage struct {
	PromptTokens        int     `json:"prompt_tokens"`
	CompletionTokens    int     `json:"completion_tokens"`
	TotalTokens         int     `json:"total_tokens"`
	CacheCreationTokens int     `json:"cache_creation_input_tokens,omitempty"`
	CacheReadTokens     int     `json:"cache_read_input_tokens,omitempty"`
	ThinkingTokens      int     `json:"thinking_tokens,omitempty"`
	CostUSD             float64 `json:"cost_usd,omitempty"`
}

// Add folds another call's usage into the running total for the turn.
func (u *Usage) Add(other *Usage) {
	if other == nil {
		return
	}
	u.PromptTokens += other.PromptTokens
	u.CompletionTokens += other.CompletionTokens
	u.TotalTokens += other.TotalTokens
	u.CacheCreationTokens += other.CacheCreationTokens
	u.CacheReadTokens += other.CacheReadTokens
	u.ThinkingTokens += other.ThinkingTokens
	u.CostUSD += other.CostUSD
}

// JSON renders usage for the `turns.usage` jsonb column.
func (u Usage) JSON() []byte {
	b, err := json.Marshal(u)
	if err != nil {
		return []byte("{}")
	}
	return b
}

// MERGE NOTE (phase 4 → phase 6)
//
// The wiring commit supplies ONE adapter, in the byok package, satisfying:
//
//	ChatProviderResolver.ChatFor(ctx, userID uuid.UUID, function string) (ChatProvider, error)
//
// returning a value that satisfies ChatProvider by delegating to a
// providers.Provider. The DTO conversions are field-for-field; the only ones
// that need care are ToolCall.Arguments (map[string]interface{} both sides) and
// Usage, whose field names above are already postclaw's json tags.
//
// If phase 4's Provider interface has drifted from scout §3, change the adapter
// — not this file. Everything in this package is written against these types.

// UnavailableResolver is the ChatProviderResolver used before phase 4's BYOK
// subsystem is merged. It refuses every turn with ErrNoProvider, which is the
// truthful answer: no provider is configured because the code that configures
// one does not exist on this branch yet.
//
// A nil resolver would panic on the first turn; a fake that returned canned
// text would make the whole chat surface look like it worked. Refusing is the
// only option that is both runnable and honest.
type UnavailableResolver struct{}

// ChatFor implements ChatProviderResolver.
func (UnavailableResolver) ChatFor(context.Context, uuid.UUID, string) (ChatProvider, error) {
	return nil, ErrNoProvider
}
