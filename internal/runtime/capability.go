package runtime

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/citations"
)

// Session is one chat conversation's row. It lives here rather than in the chat
// capability because the turn engine itself reads two of its fields: KBIDs
// scope every tool call, and AllowWeb is the gate network tools are mounted
// behind. Phases 7-10 start turns on the same sessions.
type Session struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	Title           string
	KBIDs           []uuid.UUID
	ModelHint       string
	AllowWeb        bool
	LearningStateID *uuid.UUID
	// Summary stands in for the messages up to and including
	// SummaryThroughID, which no longer fit a turn's history budget
	// (capabilities/chat/history.go). Empty until a conversation outgrows it.
	Summary          string
	SummaryThroughID *uuid.UUID
	// ConnectionID is the connection the learner picked for this
	// conversation. It is tried first, ahead of the rest of the chat route.
	ConnectionID *uuid.UUID
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// ChatMessage is one row of the linear transcript.
type ChatMessage struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	SessionID   uuid.UUID
	Role        string
	Content     string
	Capability  string
	Attachments []byte // raw jsonb
	CreatedAt   time.Time
}

// Roles a chat message may carry.
const (
	RoleUser      = "user"
	RoleAssistant = "assistant"
	RoleSystem    = "system"
	RoleTool      = "tool"
)

// ErrTurnCancelled is what a capability sees when the user pressed stop.
var ErrTurnCancelled = errors.New("turn cancelled")

// ErrNoAnswer is returned by Ask when the turn ends before the user answers.
var ErrNoAnswer = errors.New("turn ended before the question was answered")

// Capability is one kind of turn: chat (this phase), quiz (7), solve (9).
//
// A capability's Run owns the model loop. Everything around it — the row, the
// lease, the event log, cancellation, recovery — belongs to the orchestrator,
// so a new capability cannot forget to heartbeat or to close its stream.
type Capability interface {
	Name() string
	Run(ctx context.Context, tc *TurnContext) error
}

// CapabilityRegistry maps a name to its implementation.
type CapabilityRegistry struct {
	mu    sync.RWMutex
	items map[string]Capability
}

// NewCapabilityRegistry returns an empty registry.
func NewCapabilityRegistry() *CapabilityRegistry {
	return &CapabilityRegistry{items: map[string]Capability{}}
}

// Register adds a capability; a duplicate name panics at boot.
func (r *CapabilityRegistry) Register(caps ...Capability) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, c := range caps {
		if _, dup := r.items[c.Name()]; dup {
			panic("runtime: duplicate capability registration: " + c.Name())
		}
		r.items[c.Name()] = c
	}
}

// Get returns a capability by name.
func (r *CapabilityRegistry) Get(name string) (Capability, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	c, ok := r.items[name]
	if !ok {
		return nil, fmt.Errorf("runtime: unknown capability %q", name)
	}
	return c, nil
}

// TurnContext is everything a capability is handed. It is the only way a
// capability reaches the stream, the tools or the provider.
type TurnContext struct {
	Turn    Turn
	Session Session
	// Input is the user's message that started this turn.
	Input string
	// InputMessageID is the transcript row that already holds Input. A
	// capability loading history must skip it, or the model is sent the
	// question twice — see StartTurn.InputMessageID.
	InputMessageID uuid.UUID
	// Images and Params are StartTurn's, passed through unchanged.
	Images []Image
	Params map[string]string

	Bus       *StreamBus
	Tools     *ToolRegistry
	Providers ChatProviderResolver

	// TokenBudget caps the turn's total token spend; 0 means DefaultTokenBudget.
	TokenBudget int
	// AskWait overrides AskTimeout. Tests set it; production leaves it zero.
	AskWait time.Duration

	mu       sync.Mutex
	usage    Usage
	provider string
	model    string
	sources  []citations.Source
	// retrieved is the egress gate's input for CallTool: set once any tool in
	// this turn has returned the user's document text.
	retrieved bool

	answers chan Answer
	// suspend/resume flip the turn row between running and waiting_user. They
	// are funcs rather than a store handle so a capability cannot write any
	// other column.
	suspend func(ctx context.Context, q AskUser) error
	resume  func(ctx context.Context) error
}

// Param returns one of StartTurn.Params, or "".
func (tc *TurnContext) Param(key string) string { return tc.Params[key] }

// Emit publishes an event on the turn's stream.
func (tc *TurnContext) Emit(ev Event) Event { return tc.Bus.Emit(ev) }

// EmitContent publishes one token delta.
func (tc *TurnContext) EmitContent(stage, text string) {
	if text == "" {
		return
	}
	tc.Bus.Emit(Event{Type: EvContent, Stage: stage, Content: text, Source: tc.Turn.Capability})
}

// RecordProvider notes which provider and model actually served the turn. AC3
// reads this back off the row.
func (tc *TurnContext) RecordProvider(name, model string) {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	tc.provider, tc.model = name, model
}

// Served returns the provider and model RecordProvider last noted: the ones
// that actually answered, which the stored answer carries for its ratings.
func (tc *TurnContext) Served() (provider, model string) {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	return tc.provider, tc.model
}

// AddUsage folds one call's token usage into the turn total.
func (tc *TurnContext) AddUsage(u *Usage) {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	tc.usage.Add(u)
}

// Usage returns the running total.
func (tc *TurnContext) Usage() Usage {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	return tc.usage
}

// BudgetExceeded reports whether the turn has spent its token allowance.
func (tc *TurnContext) BudgetExceeded() bool {
	budget := tc.TokenBudget
	if budget <= 0 {
		budget = DefaultTokenBudget
	}
	u := tc.Usage()
	return u.PromptTokens+u.CompletionTokens+u.CacheReadTokens >= budget
}

// AddSources records citable references a tool produced. Only these ids can
// survive citation validation.
func (tc *TurnContext) AddSources(sources ...citations.Source) {
	if len(sources) == 0 {
		return
	}
	tc.mu.Lock()
	defer tc.mu.Unlock()
	tc.sources = append(tc.sources, sources...)
}

// Sources returns everything collected so far.
func (tc *TurnContext) Sources() []citations.Source {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	out := make([]citations.Source, len(tc.sources))
	copy(out, tc.sources)
	return out
}

// Ask suspends the turn on a question for the user.
//
// The row moves to `waiting_user` and a `wait_for_input` event is emitted, so a
// client that is attached renders the card and one that reconnects replays it.
// The lease keeps being refreshed while parked: a person may take minutes to
// answer, and a stale lease has to keep meaning "the worker died", not "the
// human is thinking".
func (tc *TurnContext) Ask(ctx context.Context, q AskUser) (string, error) {
	// Drain anything left in the buffer before asking. POST /answer checks the
	// turn's status and then sends; a turn that resumed or was cancelled between
	// those two steps leaves an answer behind. Without this, the NEXT ask_user
	// in the same turn would receive the previous question's answer.
	drain(tc.answers)

	questionID := uuid.NewString()
	if err := tc.suspend(ctx, q); err != nil {
		return "", err
	}
	tc.Bus.Emit(Event{
		Type:    EvWaitForInput,
		Source:  tc.Turn.Capability,
		Content: q.Question,
		Metadata: map[string]any{
			"question":    q.Question,
			"options":     q.Options,
			"question_id": questionID,
		},
	})

	// The lease is refreshed for as long as this turn lives, so a parked turn is
	// invisible to the sweeper. Without a deadline here, one person closing a
	// tab pins a goroutine, an event log and a non-terminal row open forever.
	wait := tc.AskWait
	if wait <= 0 {
		wait = AskTimeout
	}
	timeout := time.NewTimer(wait)
	defer timeout.Stop()

	for {
		select {
		case <-ctx.Done():
			return "", errors.Join(ErrNoAnswer, ctx.Err())

		case <-timeout.C:
			return "", ErrNoAnswer

		case msg, ok := <-tc.answers:
			if !ok {
				return "", ErrNoAnswer
			}
			// The question id closes the hole the drain cannot: a duplicate
			// POST arriving while a LATER question is open looks, to the
			// server, exactly like that question's answer. A client that
			// echoes the id it was shown gets the right answer paired with the
			// right question; one that sends none is trusted, because there is
			// nothing else to go on.
			if msg.QuestionID != "" && msg.QuestionID != questionID {
				tc.Bus.Emit(Event{
					Type: EvObservation, Source: tc.Turn.Capability,
					Content:  "discarded an answer addressed to an earlier question",
					Metadata: map[string]any{"discarded": true},
				})
				continue
			}

			if err := tc.resume(ctx); err != nil {
				return "", err
			}
			tc.Bus.Emit(Event{
				Type: EvObservation, Source: tc.Turn.Capability,
				Content: "the user answered", Metadata: map[string]any{"answered": true},
			})
			return msg.Text, nil
		}
	}
}

func drain(ch chan Answer) {
	for {
		select {
		case <-ch:
		default:
			return
		}
	}
}
