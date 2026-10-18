package runtime

import (
	"context"
	"log/slog"
	"time"
)

// sweepBatch caps how many orphans one pass adopts, so a restart after a long
// outage does not turn into one enormous transaction.
const sweepBatch = 100

// Recovery fails turns whose worker died.
//
// Ported in shape from DeepTutor's TurnRecoveryService
// (runtime/coordination/recovery.py:15-100), including its failure code
// WORKER_LOST. Red-team Security 9 and Assumption 6 both land here: without it
// an API restart leaves `running` rows forever and every browser attached to
// one of those turns waits on a stream that will never emit again. The phase's
// success criterion is explicit — an API restart mid-turn ends the turn as
// failed(WORKER_LOST) within 30 s and the UI shows it.
//
// Two things make the recovered turn VISIBLE rather than merely correct:
// the sweeper appends a terminal `error` event to the turn's log, and the SSE
// endpoint replays that log. A client attached to a dead process's turn is
// reconnecting on EventSource's own retry, so it lands on the new process, asks
// for events after its cursor, and is told the turn failed.
type Recovery struct {
	turns  TurnStore
	events EventStore
	buses  *BusRegistry

	interval time.Duration
}

// NewRecovery builds the sweeper.
func NewRecovery(turns TurnStore, events EventStore, buses *BusRegistry) *Recovery {
	return &Recovery{turns: turns, events: events, buses: buses, interval: SweepInterval}
}

// Start runs one sweep immediately and then every SweepInterval until ctx ends.
//
// The immediate pass is the important one: it is what runs on boot, and the
// turns it adopts are precisely the ones the previous process was running when
// it died.
func (r *Recovery) Start(ctx context.Context) {
	go func() {
		if n, err := r.Sweep(ctx); err != nil {
			slog.Error("runtime: startup turn sweep", "error", err)
		} else if n > 0 {
			slog.Warn("runtime: recovered orphaned turns at startup", "count", n)
		}

		ticker := time.NewTicker(r.interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if _, err := r.Sweep(ctx); err != nil {
					slog.Error("runtime: turn sweep", "error", err)
				}
			}
		}
	}()
}

// Sweep fails every turn whose lease has expired, and returns how many.
func (r *Recovery) Sweep(ctx context.Context) (int, error) {
	orphans, err := r.turns.ExpiredTurns(ctx, sweepBatch)
	if err != nil {
		return 0, err
	}

	recovered := 0
	for _, turn := range orphans {
		// A turn this process is actively running has a live bus here. Its
		// lease looking expired would mean the heartbeat is failing, and the
		// heartbeat cancels the turn itself in that case — stealing it from
		// under a live worker would produce two writers for one turn.
		if _, live := r.buses.Get(turn.ID); live {
			continue
		}
		if err := r.recover(ctx, turn); err != nil {
			slog.Error("runtime: recover orphaned turn", "error", err, "turn_id", turn.ID)
			continue
		}
		recovered++
	}
	return recovered, nil
}

func (r *Recovery) recover(ctx context.Context, turn Turn) error {
	updated, err := r.turns.SetStatus(ctx, turn.ID,
		[]string{StatusRunning, StatusWaitingUser}, StatusFailed,
		TurnUpdate{
			FailureCode: FailureWorkerLost,
			// Retryable: the turn failed because a process died, not because
			// the request was wrong. Re-asking the same question is expected to
			// work, which is exactly what "retryable" is for.
			Retryable:  true,
			Error:      "the worker running this turn stopped responding",
			ClearLease: true,
			Finished:   true,
		})
	if err != nil {
		return err
	}
	if updated == nil {
		// Someone else finished it between the query and the update.
		return nil
	}

	return r.appendTerminalEvents(ctx, turn)
}

// appendTerminalEvents writes the `error` event an attached client needs to
// stop waiting.
//
// It continues the turn's seq: the log is the client's resume cursor, so a
// recovery event numbered 1 would be replayed to nobody (every client is
// already past it) and would collide with the real first event.
func (r *Recovery) appendTerminalEvents(ctx context.Context, turn Turn) error {
	maxSeq, err := r.events.MaxSeq(ctx, turn.ID)
	if err != nil {
		return err
	}

	ev := Event{
		Type:      EvError,
		Source:    turn.Capability,
		Content:   "this turn stopped because the process running it went away",
		Seq:       maxSeq + 1,
		Timestamp: nowUnix(),
		TurnID:    turn.ID.String(),
		SessionID: turn.SessionID.String(),
		Metadata: map[string]any{
			"status":       StatusFailed,
			"failure_code": FailureWorkerLost,
			"retryable":    true,
		},
	}
	return r.events.AppendEvents(ctx, turn.ID, turn.UserID, []Event{ev})
}

// RecoverTurn fails one specific turn. Exposed for tests and for an operator
// path; production only calls Sweep.
func (r *Recovery) RecoverTurn(ctx context.Context, turn Turn) error { return r.recover(ctx, turn) }

// SetInterval overrides the sweep period. Tests use it; production takes the
// 30 s the phase specifies.
func (r *Recovery) SetInterval(d time.Duration) { r.interval = d }
