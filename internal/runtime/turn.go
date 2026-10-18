package runtime

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Turn statuses. The set is DeepTutor's (runtime/coordination/types.py:12-18)
// with `waiting_user` spelled out: red-team Security 9 caught that the plan's
// enum omitted it, which would have made `ask_user` unrepresentable — a turn
// parked on a question would have had to sit in `running` with no lease
// semantics that tell a sweeper apart from a hung worker.
const (
	StatusQueued      = "queued"
	StatusRunning     = "running"
	StatusWaitingUser = "waiting_user"
	StatusDone        = "done"
	StatusFailed      = "failed"
	StatusCancelled   = "cancelled"
)

// Lease timings.
//
// LeaseDuration is six heartbeats wide so a GC pause, a slow query or a
// momentarily wedged provider call does not let the sweeper steal a turn out
// from under a worker that is alive and about to emit.
const (
	HeartbeatInterval = 10 * time.Second
	LeaseDuration     = 60 * time.Second
	SweepInterval     = 30 * time.Second
)

// AskTimeout is how long a turn will wait on an ask_user question.
//
// It exists because the lease keeps being refreshed while a turn is parked, so
// the sweeper never sees a `waiting_user` turn whose person simply closed the
// tab — one abandoned question would otherwise hold a goroutine, an in-memory
// event log and a non-terminal row for the life of the process. Fifteen minutes
// is far longer than anyone answers a one-line clarification and far shorter
// than "forever".
const AskTimeout = 15 * time.Minute

// ErrTurnNotFound is returned by the store when no row matches (turn, user).
var ErrTurnNotFound = errors.New("turn not found")

// ErrInvalidTransition is returned when a status change is not legal.
var ErrInvalidTransition = errors.New("invalid turn status transition")

// Turn is one row of the `turns` table.
type Turn struct {
	ID           uuid.UUID
	UserID       uuid.UUID
	SessionID    uuid.UUID
	Capability   string
	Status       string
	FailureCode  string
	Retryable    bool
	LeaseExpires *time.Time
	HeartbeatAt  *time.Time
	Attempt      int
	Error        string
	Provider     string
	Model        string
	Usage        Usage
	CreatedAt    time.Time
	UpdatedAt    time.Time
	FinishedAt   *time.Time
}

// Terminal reports whether the turn has reached a state it never leaves.
func (t Turn) Terminal() bool {
	return t.Status == StatusDone || t.Status == StatusFailed || t.Status == StatusCancelled
}

// allowedTransitions is the state machine, written once so the store, the API
// and the sweeper cannot each hold a slightly different idea of it.
//
// Three properties it encodes:
//   - queued and running may be cancelled; a terminal status may not, so a
//     cancel racing a completion loses rather than rewriting history.
//   - waiting_user returns to running when the answer arrives, and can also
//     fail or be cancelled — a person who never answers must not pin a turn
//     open forever.
//   - nothing leaves done/failed/cancelled.
var allowedTransitions = map[string]map[string]bool{
	StatusQueued: {
		StatusRunning:   true,
		StatusFailed:    true,
		StatusCancelled: true,
	},
	StatusRunning: {
		StatusWaitingUser: true,
		StatusDone:        true,
		StatusFailed:      true,
		StatusCancelled:   true,
	},
	StatusWaitingUser: {
		StatusRunning:   true,
		StatusDone:      true,
		StatusFailed:    true,
		StatusCancelled: true,
	},
	StatusDone:      {},
	StatusFailed:    {},
	StatusCancelled: {},
}

// CanTransition reports whether from → to is a legal status change.
func CanTransition(from, to string) bool {
	next, ok := allowedTransitions[from]
	if !ok {
		return false
	}
	return next[to]
}

// CheckTransition returns a descriptive error for an illegal change, so a
// caller's log says what it tried rather than only that it failed.
func CheckTransition(from, to string) error {
	if !CanTransition(from, to) {
		return fmt.Errorf("%w: %s -> %s", ErrInvalidTransition, from, to)
	}
	return nil
}

// TurnStore is the persistence this package needs for turns. It is defined
// here, next to its consumer, rather than in one shared Stores struct —
// postclaw's grew to 60 fields and every handler then depended on all of them
// (scout §1).
type TurnStore interface {
	// CreateTurn inserts a `queued` turn.
	CreateTurn(ctx context.Context, t Turn) (*Turn, error)

	// ClaimTurn moves queued → running, stamps a lease and bumps attempt. It
	// is a conditional UPDATE, not a read-then-write: two workers racing for
	// one turn must not both win.
	ClaimTurn(ctx context.Context, turnID uuid.UUID, lease time.Duration) (*Turn, error)

	// Heartbeat extends the lease of a turn this worker still owns. It returns
	// ErrTurnNotFound when the row is no longer running/waiting_user under this
	// worker — which is how a worker learns the sweeper took its turn away.
	Heartbeat(ctx context.Context, turnID uuid.UUID, lease time.Duration) error

	// SetStatus applies a status change, enforcing the state machine in SQL so
	// a racing cancel and completion resolve to exactly one winner.
	SetStatus(ctx context.Context, turnID uuid.UUID, from []string, to string, upd TurnUpdate) (*Turn, error)

	// GetTurn reads one turn scoped to its owner.
	GetTurn(ctx context.Context, userID, turnID uuid.UUID) (*Turn, error)

	// ExpiredTurns returns running/waiting_user turns whose lease has passed.
	ExpiredTurns(ctx context.Context, limit int) ([]Turn, error)
}

// TurnUpdate carries the optional columns a status change also writes.
type TurnUpdate struct {
	FailureCode string
	Retryable   bool
	Error       string
	Provider    string
	Model       string
	Usage       *Usage
	// ClearLease drops lease_expires_at, which is what makes a terminal row
	// invisible to the sweeper.
	ClearLease bool
	// Finished stamps finished_at.
	Finished bool
}

// EventStore persists the per-turn event log the SSE endpoint replays from.
type EventStore interface {
	// AppendEvents writes a batch in one statement, ignoring rows whose
	// (turn_id, seq) already exists. Idempotence matters because a flush that
	// times out mid-write is retried, and a partially applied batch must not
	// become a duplicate-key failure that loses the rest of the turn.
	AppendEvents(ctx context.Context, turnID, userID uuid.UUID, events []Event) error

	// EventsAfter reads the persisted log for replay after a restart.
	EventsAfter(ctx context.Context, userID, turnID uuid.UUID, afterSeq int64, limit int) ([]Event, error)

	// MaxSeq returns the highest persisted seq for a turn, or 0.
	MaxSeq(ctx context.Context, turnID uuid.UUID) (int64, error)
}
