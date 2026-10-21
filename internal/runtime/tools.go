package runtime

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/citations"
)

// MaxToolRounds caps the think → tool → observe loop. A model that keeps
// calling tools without answering burns a user's tokens on their own key; eight
// is generous for "search, read two pages, answer" and small enough that the
// runaway case costs cents, not dollars.
const MaxToolRounds = 8

// DefaultTokenBudget caps a single turn's total token spend. Reaching it ends
// the turn with TOKEN_BUDGET rather than letting a degenerate repetition loop
// stream to the model's max-token ceiling — the failure postclaw hit with MiMo
// (providers/types.go, OptRepetitionPenalty note).
const DefaultTokenBudget = 200_000

// ErrToolNotFound is returned when the model names a tool that is not mounted.
var ErrToolNotFound = errors.New("tool not found")

// ToolInput is the trusted context a tool executes in. Every field comes from
// the authenticated request or the session row — NEVER from the model's
// arguments. UserID in particular is the one the authz gate checks against, so
// a tool that took it from its arguments would be authorizing the attacker's
// own claim.
type ToolInput struct {
	UserID    uuid.UUID
	SessionID uuid.UUID
	TurnID    uuid.UUID
	// KBIDs are the session's knowledge bases. A tool may narrow to a subset
	// the model asks for, but ownership of each is still checked: a session row
	// written before a KB was deleted must not keep reading it.
	KBIDs    []uuid.UUID
	AllowWeb bool
	// DocumentIDs are the documents the learner pointed at for this turn
	// (`@` in the composer). When set, a search returns only their passages.
	DocumentIDs []uuid.UUID
	// URLs numbers the web pages this turn has gathered, so `[[cite:url:<n>]]`
	// means the same page across every web tool call in the turn. Nil outside
	// research; a web tool given none numbers within its own call.
	URLs *citations.URLBook
}

// ToolResult is what a tool hands back to the loop.
type ToolResult struct {
	// Content is the text placed in the model's context. Tools that return
	// document text MUST wrap it in the provenance envelope (see
	// internal/tools/envelope.go) before putting it here.
	Content string

	// Sources are citable references this call produced. They accumulate on the
	// turn and are what `internal/citations` validates the answer's markers
	// against.
	Sources []citations.Source

	// Retrieved marks output that contains text from a user's files — anything
	// a tool wrapped in the provenance envelope.
	//
	// It is what the network-tool gate keys on, and it is deliberately NOT
	// "len(Sources) > 0". `kb_files` returns envelope-wrapped filenames with no
	// citable sources at all, and a filename is a one-line injection with no
	// document body ("ignore previous instructions.pdf"). Keying the gate on
	// citations would have let that text into a turn that still mounted network
	// tools. The requirement is "any turn whose context contains retrieved
	// document text", which is exactly this flag.
	Retrieved bool

	// Ask, when set, suspends the turn on a question for the user.
	Ask *AskUser

	// IsError marks a tool error. It is returned to the MODEL as a tool
	// message, not raised as a Go error: a foreign id, a missing document or a
	// malformed argument is something the model should see and correct, and
	// failing the whole turn on it would make one bad tool call lose a user's
	// answer.
	IsError bool
}

// AskUser is the payload of a `wait_for_input` event.
type AskUser struct {
	Question string   `json:"question"`
	Options  []string `json:"options,omitempty"`
}

// Tool is one callable the model may invoke.
type Tool interface {
	Name() string
	Definition() ToolDefinition

	// NeedsNetwork reports whether the tool can reach hosts outside this
	// deployment. It is what the injection gate keys on: no network tool is
	// mounted in a turn whose context already holds retrieved document text
	// unless the user turned on "allow web in this session". Red-team Security
	// 4 — retrieval plus an unrestricted fetch is an exfiltration channel that
	// a poisoned document drives.
	NeedsNetwork() bool

	// Execute runs the tool. args are the MODEL's arguments and are untrusted;
	// in is the trusted context.
	Execute(ctx context.Context, args map[string]any, in ToolInput) (ToolResult, error)
}

// ToolRegistry holds the tools a capability may mount.
type ToolRegistry struct {
	mu    sync.RWMutex
	tools map[string]Tool
}

// NewToolRegistry returns an empty registry.
func NewToolRegistry() *ToolRegistry {
	return &ToolRegistry{tools: map[string]Tool{}}
}

// Register adds a tool. A duplicate name is a wiring bug and panics at boot
// rather than silently shadowing — two tools answering to one name means the
// model's call is resolved by map iteration order.
func (r *ToolRegistry) Register(tools ...Tool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, t := range tools {
		if _, dup := r.tools[t.Name()]; dup {
			panic("runtime: duplicate tool registration: " + t.Name())
		}
		r.tools[t.Name()] = t
	}
}

// Get returns a mounted tool by name.
func (r *ToolRegistry) Get(name string) (Tool, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	t, ok := r.tools[name]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrToolNotFound, name)
	}
	return t, nil
}

// Mounted returns the tools available to a turn in its current state, sorted by
// name so the schema sent to the provider is stable across rounds (an unstable
// tool list defeats prompt caching and makes two identical turns diff).
//
// hasRetrievedContext becomes true the moment a tool returns document text.
// From then on a network tool is mounted only with the session's explicit
// "allow web" consent.
func (r *ToolRegistry) Mounted(allowWeb, hasRetrievedContext bool) []Tool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	out := make([]Tool, 0, len(r.tools))
	for _, t := range r.tools {
		if t.NeedsNetwork() && hasRetrievedContext && !allowWeb {
			continue
		}
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name() < out[j].Name() })
	return out
}

// Definitions renders Mounted as provider tool schemas.
func (r *ToolRegistry) Definitions(allowWeb, hasRetrievedContext bool) []ToolDefinition {
	tools := r.Mounted(allowWeb, hasRetrievedContext)
	defs := make([]ToolDefinition, 0, len(tools))
	for _, t := range tools {
		defs = append(defs, t.Definition())
	}
	return defs
}

// Names lists every registered tool. Used by wiring tests.
func (r *ToolRegistry) Names() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.tools))
	for n := range r.tools {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}
