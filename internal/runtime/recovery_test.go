package runtime

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// orphan inserts a turn that looks exactly like one whose worker was killed:
// `running`, with a lease that has already passed.
func orphan(t *testing.T, store *fakeTurnStore, status string, lease time.Duration) Turn {
	t.Helper()
	turn, err := store.CreateTurn(context.Background(), Turn{
		UserID: uuid.New(), SessionID: uuid.New(), Capability: "chat",
	})
	if err != nil {
		t.Fatalf("CreateTurn: %v", err)
	}
	if _, err := store.ClaimTurn(context.Background(), turn.ID, lease); err != nil {
		t.Fatalf("ClaimTurn: %v", err)
	}
	if status == StatusWaitingUser {
		if _, err := store.SetStatus(context.Background(), turn.ID,
			[]string{StatusRunning}, StatusWaitingUser, TurnUpdate{}); err != nil {
			t.Fatalf("park: %v", err)
		}
	}
	// Re-read so the caller has the claimed row.
	got, err := store.GetTurn(context.Background(), turn.UserID, turn.ID)
	if err != nil {
		t.Fatalf("GetTurn: %v", err)
	}
	return *got
}

// The phase's success criterion, in miniature: a turn with an expired lease
// becomes failed(WORKER_LOST, retryable) and grows a terminal `error` event so
// an attached client stops waiting.
func TestSweeperFailsExpiredLeasesWithWorkerLost(t *testing.T) {
	for _, status := range []string{StatusRunning, StatusWaitingUser} {
		t.Run(status, func(t *testing.T) {
			turns := newFakeTurnStore()
			events := newFakeEventStore()
			buses := NewBusRegistry()

			// Lease already gone: a worker that died five seconds ago.
			turn := orphan(t, turns, status, -5*time.Second)

			// Some events already happened before the process died.
			for i := 1; i <= 3; i++ {
				_ = events.AppendEvents(context.Background(), turn.ID, turn.UserID,
					[]Event{{Type: EvContent, Seq: int64(i), Content: "tok"}})
			}

			rec := NewRecovery(turns, events, buses)
			n, err := rec.Sweep(context.Background())
			if err != nil {
				t.Fatalf("Sweep: %v", err)
			}
			if n != 1 {
				t.Fatalf("swept %d turns, want 1", n)
			}

			final, err := turns.GetTurn(context.Background(), turn.UserID, turn.ID)
			if err != nil {
				t.Fatalf("GetTurn: %v", err)
			}
			if final.Status != StatusFailed {
				t.Fatalf("status = %q, want failed", final.Status)
			}
			if final.FailureCode != FailureWorkerLost {
				t.Fatalf("failure_code = %q, want %s", final.FailureCode, FailureWorkerLost)
			}
			if !final.Retryable {
				t.Error("WORKER_LOST is not retryable; a process dying is exactly the case worth retrying")
			}
			if final.LeaseExpires != nil {
				t.Error("the lease survived recovery; the next sweep would fail it again")
			}

			// The terminal event must CONTINUE the seq, not restart it: a
			// client sitting at cursor 3 would never be told about seq 1.
			all := events.all()
			last := all[len(all)-1]
			if last.Type != EvError {
				t.Fatalf("last persisted event is %q, want error", last.Type)
			}
			if last.Seq != 4 {
				t.Fatalf("terminal event seq = %d, want 4 (continuing the log)", last.Seq)
			}
			if last.Metadata["failure_code"] != FailureWorkerLost {
				t.Errorf("terminal event does not carry the failure code: %+v", last.Metadata)
			}
		})
	}
}

// A live lease is left alone. Without this the sweeper would fail turns that
// are working perfectly.
func TestSweeperLeavesLiveLeasesAlone(t *testing.T) {
	turns := newFakeTurnStore()
	events := newFakeEventStore()
	turn := orphan(t, turns, StatusRunning, time.Minute)

	n, err := NewRecovery(turns, events, NewBusRegistry()).Sweep(context.Background())
	if err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if n != 0 {
		t.Fatalf("swept %d turns with live leases", n)
	}
	final, _ := turns.GetTurn(context.Background(), turn.UserID, turn.ID)
	if final.Status != StatusRunning {
		t.Fatalf("a live turn was moved to %q", final.Status)
	}
}

// A turn THIS process is running is skipped even when its lease looks stale.
// Two writers for one turn is worse than a late recovery, and the heartbeat
// cancels such a turn from the inside anyway.
func TestSweeperSkipsTurnsRunningInThisProcess(t *testing.T) {
	turns := newFakeTurnStore()
	events := newFakeEventStore()
	buses := NewBusRegistry()

	turn := orphan(t, turns, StatusRunning, -time.Minute)
	buses.Add(turn.ID, NewStreamBus(turn.ID, turn.SessionID), func() {}, nil)

	n, err := NewRecovery(turns, events, buses).Sweep(context.Background())
	if err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if n != 0 {
		t.Fatalf("the sweeper stole %d turns from a live worker", n)
	}
}

// A terminal turn is invisible to the sweeper, because its lease was cleared.
func TestSweeperIgnoresFinishedTurns(t *testing.T) {
	turns := newFakeTurnStore()
	events := newFakeEventStore()

	turn := orphan(t, turns, StatusRunning, -time.Minute)
	if _, err := turns.SetStatus(context.Background(), turn.ID,
		[]string{StatusRunning}, StatusDone, TurnUpdate{ClearLease: true, Finished: true}); err != nil {
		t.Fatalf("finish: %v", err)
	}

	n, err := NewRecovery(turns, events, NewBusRegistry()).Sweep(context.Background())
	if err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if n != 0 {
		t.Fatalf("swept %d finished turns", n)
	}
}

// Start does a pass immediately — that pass IS the restart recovery, and
// waiting a full interval for it would exceed the 30 s the phase promises.
func TestStartSweepsImmediately(t *testing.T) {
	turns := newFakeTurnStore()
	events := newFakeEventStore()
	turn := orphan(t, turns, StatusRunning, -time.Minute)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	rec := NewRecovery(turns, events, NewBusRegistry())
	rec.SetInterval(time.Hour) // only the startup pass can possibly run
	rec.Start(ctx)

	waitFor(t, func() bool {
		final, err := turns.GetTurn(context.Background(), turn.UserID, turn.ID)
		return err == nil && final.Status == StatusFailed
	})
}
