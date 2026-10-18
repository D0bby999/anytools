package runtime

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"runtime/debug"
	"time"

	"github.com/google/uuid"
)

// Orchestrator owns a turn's lifecycle. Capabilities own what happens inside
// it.
type Orchestrator struct {
	turns        TurnStore
	events       EventStore
	capabilities *CapabilityRegistry
	tools        *ToolRegistry
	toolsFor     map[string]*ToolRegistry
	providers    ChatProviderResolver
	registry     *BusRegistry

	// done is closed per turn in tests to await completion deterministically.
	onFinish func(turnID uuid.UUID, status string)
}

// OrchestratorDeps are the collaborators an Orchestrator needs.
type OrchestratorDeps struct {
	Turns        TurnStore
	Events       EventStore
	Capabilities *CapabilityRegistry
	Tools        *ToolRegistry
	// CapabilityTools gives a named capability its OWN registry in place of
	// Tools. It is how a tool is made available to one kind of turn and absent
	// from every other: phase 9 mounts web_search and web_fetch for `research`
	// only, so a chat turn cannot reach the network at all, whatever the
	// session's allow-web toggle says. Absence is structural rather than a
	// check each capability must remember to make.
	CapabilityTools map[string]*ToolRegistry
	Providers       ChatProviderResolver
	Buses           *BusRegistry

	// OnFinish, when set, is called after a turn reaches a terminal status.
	// Tests use it to await a turn without polling; production leaves it nil.
	OnFinish func(turnID uuid.UUID, status string)
}

// NewOrchestrator wires an orchestrator.
func NewOrchestrator(deps OrchestratorDeps) *Orchestrator {
	buses := deps.Buses
	if buses == nil {
		buses = NewBusRegistry()
	}
	return &Orchestrator{
		turns:        deps.Turns,
		events:       deps.Events,
		capabilities: deps.Capabilities,
		tools:        deps.Tools,
		toolsFor:     deps.CapabilityTools,
		providers:    deps.Providers,
		registry:     buses,
		onFinish:     deps.OnFinish,
	}
}

// toolsForCapability returns the registry a capability's turns mount.
func (o *Orchestrator) toolsForCapability(name string) *ToolRegistry {
	if r, ok := o.toolsFor[name]; ok && r != nil {
		return r
	}
	return o.tools
}

// Buses exposes the registry so the API can attach a stream, cancel a turn or
// deliver an ask_user answer.
func (o *Orchestrator) Buses() *BusRegistry { return o.registry }

// StartTurn is what the API calls: create the row and run it.
type StartTurn struct {
	Session    Session
	Capability string
	Input      string
	// InputMessageID is the chat_messages row the API already wrote for this
	// turn's question.
	//
	// It exists because the question is persisted BEFORE the turn starts (so a
	// crash leaves a transcript that shows what was asked), which means the
	// capability's own history read already contains it. Without this id the
	// capability appends the question a second time and every turn ships the
	// user's words to the model twice — paid for on the user's own key, and
	// rejected outright by any provider that requires strict role alternation.
	InputMessageID uuid.UUID
	// TokenBudget overrides DefaultTokenBudget for this turn.
	TokenBudget int
	// Images are attached to the user's input for a vision-capable model
	// (solve's photographed problem). Held in memory for the life of the turn
	// and never persisted: the transcript row records what was attached, not
	// the bytes.
	Images []Image
	// Params are capability-specific switches the API validated — research's
	// mode, solve's "check my answer" variant. Strings, so nothing a client
	// sends can arrive as a type the capability did not expect.
	Params map[string]string
}

// Run creates a `queued` turn and starts it on its own goroutine, returning as
// soon as the row exists.
//
// The HTTP request that starts a turn must not wait for the model: the client's
// next move is to open the event stream, and a POST that blocked until the
// answer was written would make the stream pointless.
func (o *Orchestrator) Run(ctx context.Context, req StartTurn) (*Turn, error) {
	capability, err := o.capabilities.Get(req.Capability)
	if err != nil {
		return nil, err
	}

	turn, err := o.turns.CreateTurn(ctx, Turn{
		UserID:     req.Session.UserID,
		SessionID:  req.Session.ID,
		Capability: req.Capability,
		Status:     StatusQueued,
	})
	if err != nil {
		return nil, err
	}

	bus := NewStreamBus(turn.ID, req.Session.ID)
	sink := NewEventSink(o.events, turn.ID, turn.UserID)
	bus.OnEmit(sink.Add)

	// The turn's context is NOT the request's. The request ends when the POST
	// returns; the turn keeps running and streaming to whoever attaches.
	turnCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	answers := make(chan Answer, 1)
	o.registry.Add(turn.ID, bus, cancel, answers)

	go o.run(turnCtx, cancel, sink, bus, answers, capability, req, *turn)
	return turn, nil
}

func (o *Orchestrator) run(
	ctx context.Context,
	cancel context.CancelFunc,
	sink *EventSink,
	bus *StreamBus,
	answers chan Answer,
	capability Capability,
	req StartTurn,
	turn Turn,
) {
	defer cancel()
	// Safety net only: finish() deregisters before it writes the terminal row.
	// This catches a path that returns without finishing at all.
	defer o.registry.Remove(turn.ID)
	defer sink.Close()

	claimed, err := o.turns.ClaimTurn(ctx, turn.ID, LeaseDuration)
	if err != nil {
		// Losing the claim means someone else already owns this turn — almost
		// always a cancel that arrived between the POST returning and this
		// goroutine starting. It is NOT a failure of the turn, and reporting it
		// as one told the user their deliberate stop was "turn <uuid> is not
		// queued": an internal sentence, on a screen, describing a working
		// system. Report whatever the row actually says instead.
		o.reportExisting(ctx, bus, sink, turn)
		return
	}
	turn = *claimed

	bus.Emit(Event{Type: EvSession, Source: capability.Name(),
		Metadata: map[string]any{"session_id": req.Session.ID.String(), "turn_id": turn.ID.String()}})

	stopHeartbeat := o.startHeartbeat(ctx, cancel, turn.ID)
	defer stopHeartbeat()

	tc := &TurnContext{
		Turn:           turn,
		Session:        req.Session,
		Input:          req.Input,
		InputMessageID: req.InputMessageID,
		Images:         req.Images,
		Params:         req.Params,
		Bus:            bus,
		Tools:          o.toolsForCapability(capability.Name()),
		Providers:      o.providers,
		TokenBudget:    req.TokenBudget,
		answers:        answers,
		suspend: func(ctx context.Context, q AskUser) error {
			_, err := o.turns.SetStatus(ctx, turn.ID, []string{StatusRunning}, StatusWaitingUser, TurnUpdate{})
			return err
		},
		resume: func(ctx context.Context) error {
			_, err := o.turns.SetStatus(ctx, turn.ID, []string{StatusWaitingUser}, StatusRunning, TurnUpdate{})
			return err
		},
	}

	runErr := runCapability(ctx, capability, tc)

	upd := TurnUpdate{
		Provider:   tc.provider,
		Model:      tc.model,
		Usage:      ptr(tc.Usage()),
		ClearLease: true,
		Finished:   true,
	}

	switch {
	case runErr == nil:
		o.finish(ctx, bus, sink, turn, StatusDone, upd, "")

	case errors.Is(runErr, ErrTurnCancelled) || errors.Is(runErr, context.Canceled):
		// A cancel already wrote `cancelled` from the HTTP handler; this
		// transition is the one that runs when the capability noticed first.
		// Both are conditional updates, so exactly one wins and the loser is a
		// no-op, not an error.
		o.finish(ctx, bus, sink, turn, StatusCancelled, upd, "")

	default:
		code, retryable := classify(runErr)
		upd.FailureCode, upd.Retryable, upd.Error = code, retryable, runErr.Error()
		o.finish(ctx, bus, sink, turn, StatusFailed, upd, runErr.Error())
	}
}

// finish writes the terminal row, emits the terminal events and flushes them.
//
// The order is deliberate: the row first, then the events. A client that sees
// `done` and immediately re-reads the turn must not find it still `running`.
func (o *Orchestrator) finish(
	ctx context.Context, bus *StreamBus, sink *EventSink,
	turn Turn, status string, upd TurnUpdate, errMsg string,
) {
	// Deregister FIRST. From this point the turn is neither cancellable nor
	// answerable, which is exactly right — it is ending — and it means anything
	// observing the terminal event (a test's OnFinish, an operator's tooling)
	// sees a consistent world rather than a finished turn that still looks live
	// in the registry. Subscribers already hold their own channels, so delivery
	// of the terminal event below is unaffected, and a client attaching after
	// this falls through to the store path, which synthesizes the terminal frame
	// from the row.
	o.registry.Remove(turn.ID)

	// Use a detached context: the turn's own context is already cancelled on
	// the cancel path, and a terminal write that inherits it never lands.
	writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()

	if _, err := o.turns.SetStatus(writeCtx, turn.ID, allowedSources(status), status, upd); err != nil {
		if !errors.Is(err, ErrTurnNotFound) {
			slog.Error("runtime: write terminal turn status",
				"error", err, "turn_id", turn.ID, "status", status)
		}
	}

	if status == StatusFailed || status == StatusCancelled {
		bus.Emit(Event{
			Type: EvError, Source: turn.Capability, Content: errMsg,
			Metadata: map[string]any{"status": status, "failure_code": upd.FailureCode, "retryable": upd.Retryable},
		})
	} else {
		bus.Emit(Event{Type: EvDone, Source: turn.Capability,
			Metadata: map[string]any{"status": status}})
	}
	// `error` is terminal, so the bus closed on it and a `done` after it would
	// be dropped — which is correct: the client's stream ends on either.
	sink.Flush()

	if o.onFinish != nil {
		o.onFinish(turn.ID, status)
	}
}

// reportExisting emits the terminal event for a turn this goroutine did not
// win, without writing any status of its own: the winner already did that.
func (o *Orchestrator) reportExisting(ctx context.Context, bus *StreamBus, sink *EventSink, turn Turn) {
	o.registry.Remove(turn.ID)

	readCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()

	current, err := o.turns.GetTurn(readCtx, turn.UserID, turn.ID)
	if err != nil || current == nil {
		bus.Emit(Event{Type: EvError, Source: turn.Capability,
			Content: "this turn could not be started"})
		sink.Flush()
		return
	}

	if current.Status == StatusDone {
		bus.Emit(Event{Type: EvDone, Source: turn.Capability,
			Metadata: map[string]any{"status": current.Status}})
	} else {
		bus.Emit(Event{
			Type: EvError, Source: turn.Capability, Content: current.Error,
			Metadata: map[string]any{
				"status": current.Status, "failure_code": current.FailureCode,
				"retryable": current.Retryable,
			},
		})
	}
	sink.Flush()

	if o.onFinish != nil {
		o.onFinish(turn.ID, current.Status)
	}
}

func (o *Orchestrator) finishFailed(
	ctx context.Context, bus *StreamBus, sink *EventSink,
	turn Turn, code string, retryable bool, err error,
) {
	o.finish(ctx, bus, sink, turn, StatusFailed, TurnUpdate{
		FailureCode: code, Retryable: retryable, Error: err.Error(),
		ClearLease: true, Finished: true,
	}, err.Error())
}

// startHeartbeat refreshes the lease every HeartbeatInterval and CANCELS the
// turn when the refresh fails.
//
// That cancellation is the point. A heartbeat that only logged would let a
// worker whose turn the sweeper already failed keep calling the provider and
// keep emitting into a stream nobody reads — spending the user's tokens on a
// turn that is, of record, dead.
func (o *Orchestrator) startHeartbeat(ctx context.Context, cancel context.CancelFunc, turnID uuid.UUID) func() {
	ticker := time.NewTicker(HeartbeatInterval)
	stop := make(chan struct{})
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-stop:
				return
			case <-ticker.C:
				hbCtx, hbCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
				err := o.turns.Heartbeat(hbCtx, turnID, LeaseDuration)
				hbCancel()
				if errors.Is(err, ErrTurnNotFound) {
					slog.Warn("runtime: lost turn lease, cancelling", "turn_id", turnID)
					cancel()
					return
				}
				if err != nil {
					slog.Error("runtime: heartbeat", "error", err, "turn_id", turnID)
				}
			}
		}
	}()
	return func() { close(stop) }
}

// allowedSources returns the non-terminal statuses a turn may legally reach
// `to` from.
//
// It is derived from the state machine rather than written out, so a guard list
// can never contain a transition CheckTransition would reject — which is what
// happened when the terminal write named `queued` alongside `running` for a
// `done` target: a turn that was actually running never got its terminal row
// because the guard list itself was invalid.
func allowedSources(to string) []string {
	var out []string
	for _, from := range []string{StatusQueued, StatusRunning, StatusWaitingUser} {
		if CanTransition(from, to) {
			out = append(out, from)
		}
	}
	return out
}

// classify maps a capability error to a failure code and whether retrying it
// could plausibly work. Retryable is advisory — nothing auto-retries in this
// phase — but it is what a "try again" button keys on, and marking a budget
// overrun retryable would offer the user a button that spends more money to
// fail identically.
func classify(err error) (code string, retryable bool) {
	switch {
	case errors.Is(err, ErrNoProvider):
		return FailureNoProvider, false
	case errors.Is(err, ErrToolRoundLimit):
		return FailureToolRounds, false
	case errors.Is(err, ErrTokenBudget):
		return FailureTokenBudget, false
	case errors.Is(err, ErrProvider):
		return FailureProvider, true
	case errors.Is(err, context.DeadlineExceeded):
		return FailureProvider, true
	default:
		return FailureCapability, false
	}
}

// Errors a capability returns that the orchestrator classifies.
var (
	// ErrProvider wraps an upstream LLM failure: a 5xx, a timeout, a dropped
	// stream. Retryable.
	ErrProvider = errors.New("provider call failed")
	// ErrToolRoundLimit means the loop hit MaxToolRounds without answering.
	ErrToolRoundLimit = errors.New("tool round limit reached")
	// ErrTokenBudget means the turn spent its allowance.
	ErrTokenBudget = errors.New("token budget exhausted")
)

func ptr[T any](v T) *T { return &v }

// runCapability calls a capability and turns a panic into an ordinary turn
// failure. A turn runs in its own goroutine and feeds model and tool output to
// parsers; an unrecovered panic there would end the process and every other
// user's turn with it (security audit F-1).
func runCapability(ctx context.Context, capability Capability, tc *TurnContext) (err error) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("runtime: capability panicked", "capability", capability.Name(),
				"turn", tc.Turn.ID, "panic", fmt.Sprint(r), "stack", string(debug.Stack()))
			err = fmt.Errorf("the %s capability failed unexpectedly", capability.Name())
		}
	}()
	return capability.Run(ctx, tc)
}
