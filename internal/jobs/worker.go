package jobs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"runtime/debug"
	"time"

	"github.com/google/uuid"
)

// Handler runs one job. Returning a TerminalError gives up immediately instead
// of spending the remaining attempts.
type Handler func(ctx context.Context, job *Job) error

// TerminalError wraps an error that retrying cannot fix.
type TerminalError struct{ Err error }

func (e *TerminalError) Error() string { return e.Err.Error() }
func (e *TerminalError) Unwrap() error { return e.Err }

// Terminal marks an error as not worth retrying.
func Terminal(err error) error { return &TerminalError{Err: err} }

// Worker polls the queue and runs handlers.
type Worker struct {
	queue    *Queue
	handlers map[string]Handler
	id       string
	poll     time.Duration
}

// NewWorker returns a Worker. `id` must be unique per process; it is what the
// lease is taken in the name of.
func NewWorker(queue *Queue, id string, poll time.Duration) *Worker {
	if poll <= 0 {
		poll = time.Second
	}
	if id == "" {
		id = uuid.NewString()
	}
	return &Worker{queue: queue, handlers: map[string]Handler{}, id: id, poll: poll}
}

// ID is the worker's lease identity.
func (w *Worker) ID() string { return w.id }

// Handle registers a handler for a kind.
func (w *Worker) Handle(kind string, h Handler) { w.handlers[kind] = h }

func (w *Worker) kinds() []string {
	out := make([]string, 0, len(w.handlers))
	for k := range w.handlers {
		out = append(out, k)
	}
	return out
}

// Run polls until ctx is cancelled.
//
// Polling, not LISTEN/NOTIFY. A notification is delivered at most once and only
// to a connection that is listening at that moment, so a job enqueued while the
// worker was reconnecting would wait for the next one to arrive. A one-second
// poll on an indexed partial query costs nothing and cannot lose work; phase 12
// can add NOTIFY as a latency optimisation on top, never as the mechanism.
func (w *Worker) Run(ctx context.Context) {
	kinds := w.kinds()
	if len(kinds) == 0 {
		return
	}
	ticker := time.NewTicker(w.poll)
	defer ticker.Stop()

	for {
		// Drain: keep claiming while there is work, so a burst of uploads is
		// not metered out at one document per poll interval.
		for {
			if ctx.Err() != nil {
				return
			}
			job, err := w.queue.Claim(ctx, w.id, kinds)
			if errors.Is(err, ErrNoJob) {
				break
			}
			if err != nil {
				if ctx.Err() == nil {
					slog.Error("jobs: claim failed", "error", err, "worker", w.id)
				}
				break
			}
			w.runOne(ctx, job)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// RunOnce claims and runs at most one job. Tests use it to drive the queue
// deterministically instead of racing a ticker.
func (w *Worker) RunOnce(ctx context.Context) (bool, error) {
	job, err := w.queue.Claim(ctx, w.id, w.kinds())
	if errors.Is(err, ErrNoJob) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	w.runOne(ctx, job)
	return true, nil
}

func (w *Worker) runOne(ctx context.Context, job *Job) {
	handler, ok := w.handlers[job.Kind]
	if !ok {
		// A kind this build does not know is not a transient condition.
		_, _ = w.queue.Fail(ctx, job.ID, w.id, errors.New("jobs: no handler for kind "+job.Kind), true)
		return
	}

	// Heartbeat for as long as the handler runs. The handler's context is
	// cancelled the moment the lease is lost, so a worker that has been reaped
	// stops touching the document another worker may already be parsing.
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go w.heartbeat(runCtx, job.ID, cancel)

	err := runHandler(runCtx, handler, job)
	// Report on the parent context: runCtx may already be cancelled, and a
	// failure nobody could record is the stuck-document bug again.
	reportCtx, reportCancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer reportCancel()

	if err != nil {
		var terminal *TerminalError
		gaveUp, ferr := w.queue.Fail(reportCtx, job.ID, w.id, err, errors.As(err, &terminal))
		if ferr != nil {
			slog.Error("jobs: could not record failure", "error", ferr, "job", job.ID)
		}
		slog.Warn("jobs: job failed", "job", job.ID, "kind", job.Kind,
			"attempt", job.Attempts, "of", job.MaxAttempts, "gave_up", gaveUp, "error", err)
		return
	}
	if err := w.queue.Complete(reportCtx, job.ID, w.id); err != nil {
		slog.Error("jobs: could not mark done", "error", err, "job", job.ID)
	}
}

// heartbeat extends the lease at a third of its length and cancels the job's
// context once the lease is gone.
//
// It tracks the last SUCCESSFUL beat, not just the last explicit refusal. A
// heartbeat that keeps erroring — a database blip, a saturated pool — used to
// log and continue forever, so a worker could run past its own lease while the
// reaper handed the job to somebody else, with two workers on one document and
// an uncancelled context on the first. Silence for a whole lease is a lost
// lease whether or not anyone said so.
func (w *Worker) heartbeat(ctx context.Context, jobID uuid.UUID, cancel context.CancelFunc) {
	lease := w.queue.Lease()
	interval := lease / 3
	if interval < time.Second {
		interval = time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	lastOK := time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			ok, err := w.queue.Heartbeat(ctx, jobID, w.id)
			switch {
			case err != nil:
				if ctx.Err() != nil {
					return
				}
				slog.Error("jobs: heartbeat failed", "error", err, "job", jobID)
				if time.Since(lastOK) >= lease {
					// The lease has certainly expired by now, so the reaper has
					// taken the row and another worker may already hold it.
					// Carrying on would put two of us on the same document.
					slog.Warn("jobs: lease presumed lost after repeated heartbeat failures",
						"job", jobID, "worker", w.id, "silent_for", time.Since(lastOK))
					cancel()
					return
				}
			case !ok:
				slog.Warn("jobs: lease lost, abandoning job", "job", jobID, "worker", w.id)
				cancel()
				return
			default:
				lastOK = time.Now()
			}
		}
	}
}

// runHandler calls a handler and turns a panic into a TERMINAL failure.
//
// A handler runs in a bare goroutine, and a panic nobody recovers in any
// goroutine ends the whole process: one crafted upload that panics a
// third-party parser would take the API down for every user, then again on
// every retry (security audit F-1). Terminal, because an input that panicked
// once will panic again, and a retry only buys another attempt at it.
func runHandler(ctx context.Context, handler Handler, job *Job) (err error) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("jobs: handler panicked", "job", job.ID, "kind", job.Kind,
				"panic", fmt.Sprint(r), "stack", string(debug.Stack()))
			err = Terminal(fmt.Errorf("jobs: the %s handler failed unexpectedly", job.Kind))
		}
	}()
	return handler(ctx, job)
}
