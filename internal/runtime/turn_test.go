package runtime

import (
	"errors"
	"testing"
)

// The state machine, spelled out as a table so a future edit to
// allowedTransitions has to change this list too — which is the point.
func TestTurnStateMachine(t *testing.T) {
	legal := []struct{ from, to string }{
		{StatusQueued, StatusRunning},
		{StatusQueued, StatusFailed},
		{StatusQueued, StatusCancelled},
		{StatusRunning, StatusWaitingUser},
		{StatusRunning, StatusDone},
		{StatusRunning, StatusFailed},
		{StatusRunning, StatusCancelled},
		{StatusWaitingUser, StatusRunning},
		{StatusWaitingUser, StatusDone},
		{StatusWaitingUser, StatusFailed},
		{StatusWaitingUser, StatusCancelled},
	}
	for _, tc := range legal {
		if !CanTransition(tc.from, tc.to) {
			t.Errorf("%s -> %s should be legal", tc.from, tc.to)
		}
	}

	illegal := []struct{ from, to string }{
		// Nothing leaves a terminal status: a cancel that arrives after the
		// answer must not rewrite history.
		{StatusDone, StatusRunning},
		{StatusDone, StatusCancelled},
		{StatusFailed, StatusRunning},
		{StatusCancelled, StatusRunning},
		{StatusCancelled, StatusDone},
		// A queued turn has not started, so it cannot be parked on a question.
		{StatusQueued, StatusWaitingUser},
		// A turn cannot be claimed twice.
		{StatusRunning, StatusRunning},
		{"nonsense", StatusRunning},
		{StatusRunning, "nonsense"},
	}
	for _, tc := range illegal {
		if CanTransition(tc.from, tc.to) {
			t.Errorf("%s -> %s should be refused", tc.from, tc.to)
		}
		if err := CheckTransition(tc.from, tc.to); !errors.Is(err, ErrInvalidTransition) {
			t.Errorf("CheckTransition(%s, %s) = %v, want ErrInvalidTransition", tc.from, tc.to, err)
		}
	}
}

func TestTerminalStatuses(t *testing.T) {
	for status, want := range map[string]bool{
		StatusQueued:      false,
		StatusRunning:     false,
		StatusWaitingUser: false,
		StatusDone:        true,
		StatusFailed:      true,
		StatusCancelled:   true,
	} {
		if got := (Turn{Status: status}).Terminal(); got != want {
			t.Errorf("Turn{%s}.Terminal() = %v, want %v", status, got, want)
		}
	}
}

// The lease has to be several heartbeats wide, or a single slow query lets the
// sweeper steal a turn from a worker that is alive.
func TestLeaseIsSeveralHeartbeatsWide(t *testing.T) {
	if LeaseDuration < 3*HeartbeatInterval {
		t.Fatalf("lease %s is less than three heartbeats of %s — one slow query loses a live turn",
			LeaseDuration, HeartbeatInterval)
	}
	// And the sweeper must not run more often than the lease can be refreshed,
	// or every pass sees turns mid-heartbeat.
	if SweepInterval < HeartbeatInterval {
		t.Fatalf("sweep interval %s is shorter than the heartbeat %s", SweepInterval, HeartbeatInterval)
	}
}

func TestUsageAddAccumulates(t *testing.T) {
	var total Usage
	total.Add(&Usage{PromptTokens: 10, CompletionTokens: 5, TotalTokens: 15, CostUSD: 0.01})
	total.Add(&Usage{PromptTokens: 3, CompletionTokens: 2, TotalTokens: 5, CacheReadTokens: 7})
	total.Add(nil) // a provider that reports nothing must not panic

	if total.PromptTokens != 13 || total.CompletionTokens != 7 || total.TotalTokens != 20 {
		t.Fatalf("accumulated usage = %+v", total)
	}
	if total.CacheReadTokens != 7 || total.CostUSD != 0.01 {
		t.Fatalf("accumulated usage lost a field: %+v", total)
	}
}
