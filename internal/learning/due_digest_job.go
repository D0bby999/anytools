package learning

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/jobs"
)

// due_digest_job.go is the ONLY scheduled job in the mastery feature, and its
// only job is to tell people what is waiting.
//
// It does not materialize review tasks, and that is the whole point. Red-team
// RT-12 / Assumption 9: FSRS-6's relearning step is ten minutes, so a nightly
// pass that wrote out "what is due in the next 24 hours" would miss every card
// a learner failed during the day — the same-day relearning AC4 requires would
// simply not appear until tomorrow. Due is computed on read
// (`kp_state.due_at <= now()`), every time, and this job reads that same query
// to compose a summary.
//
// It is advisory-locked because a summary sent twice is a notification a person
// stops trusting, and because red-team RT-8 named exactly this failure: two
// processes both deciding it is 03:00.

// DueDigestLock is the advisory-lock name this job holds while it runs.
const DueDigestLock = "mastery-due-digest"

// DigestHour is the local hour the digest runs at.
//
// 07:00 rather than 03:00: the summary is for a person's morning, and a
// notification composed six hours before anyone reads it can be wrong by then —
// they may have studied at midnight.
const DigestHour = 7

// DueSummary is one user's "due today". It lives in this package rather than in
// internal/capabilities/mastery because the job consumes it and mastery imports
// this package, not the other way round; mastery re-exports it as DueDigest.
type DueSummary struct {
	UserID uuid.UUID `json:"user_id"`
	Due    int       `json:"due"`
	Paths  int       `json:"paths"`
	// NextDue is the earliest date among the user's not-yet-due points, so a
	// digest can say "three waiting, four more tomorrow".
	NextDue *time.Time `json:"next_due,omitempty"`
}

// DueSource is the query the digest reads. It is NOT user-scoped — a digest is
// by definition across users — which is exactly why the caller is locked.
type DueSource interface {
	DueDigests(ctx context.Context, now time.Time) ([]DueSummary, error)
}

// Notifier delivers one user's summary.
//
// AnyTools has no email, no push and no inbox: free + BYOK, no platform
// services of any kind. LogNotifier is therefore the honest default — the
// digest is computed and recorded where an operator can see it, and the surface
// a learner actually reads is the live Due list on the page, which needs no job
// at all. When a delivery channel exists, it implements this and nothing else
// in the job changes.
type Notifier interface {
	Notify(ctx context.Context, summary DueSummary) error
}

// LogNotifier writes each summary to the structured log.
type LogNotifier struct{}

// Notify implements Notifier.
func (LogNotifier) Notify(_ context.Context, s DueSummary) error {
	slog.Info("mastery: due digest", "user", s.UserID, "due", s.Due, "paths", s.Paths)
	return nil
}

// DueDigestJob composes and delivers the daily summary.
type DueDigestJob struct {
	pool   *pgxpool.Pool
	source DueSource
	notify Notifier
	now    func() time.Time

	// lastRun is the local date of the last completed pass. It stops an hourly
	// ticker from sending a second digest at 08:00 on the same day. It is
	// process-local, which is sound here only because the API is single-replica
	// by rule (plan.md, phase 1); the advisory lock is what makes a second
	// process safe, and this is what makes a second TICK safe.
	lastRun string
}

// NewDueDigestJob builds the job. A nil notifier logs.
func NewDueDigestJob(pool *pgxpool.Pool, source DueSource, notify Notifier) *DueDigestJob {
	if notify == nil {
		notify = LogNotifier{}
	}
	return &DueDigestJob{pool: pool, source: source, notify: notify, now: time.Now}
}

// SetClock overrides the job's clock. Tests use it; production does not.
func (j *DueDigestJob) SetClock(now func() time.Time) { j.now = now }

// RunOnce composes and delivers one pass, holding the advisory lock.
//
// It returns ran=false when another process held the lock, WITHOUT an error and
// without doing any work. That is the correct outcome, not a failure: the
// digest is going out, just not from here. `try`, never `wait` — a nightly job
// that queues behind the one already running is a nightly job that runs twice.
func (j *DueDigestJob) RunOnce(ctx context.Context) (sent int, ran bool, err error) {
	ran, err = jobs.WithAdvisoryLock(ctx, j.pool, DueDigestLock, func(ctx context.Context) error {
		now := j.now().UTC()
		summaries, err := j.source.DueDigests(ctx, now)
		if err != nil {
			return err
		}
		for _, s := range summaries {
			if err := j.notify.Notify(ctx, s); err != nil {
				// One undeliverable summary must not cost every other user
				// theirs. It is logged and the pass continues.
				slog.Warn("mastery: due digest delivery failed", "user", s.UserID, "error", err)
				continue
			}
			sent++
		}
		j.lastRun = j.now().Format(time.DateOnly)
		return nil
	})
	return sent, ran, err
}

// Start runs the digest once a day, at DigestHour.
//
// The ticker is hourly rather than a 24-hour timer because a 24-hour timer
// started at boot fires at whatever time the process happened to restart, which
// over a month of deploys drifts the "morning summary" to the middle of the
// night. An hourly tick that checks the clock cannot drift.
func (j *DueDigestJob) Start(ctx context.Context) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !j.dueToRun() {
				continue
			}
			sent, ran, err := j.RunOnce(ctx)
			switch {
			case err != nil:
				slog.Error("mastery: due digest failed", "error", err)
			case ran:
				slog.Info("mastery: due digest sent", "users", sent)
			}
		}
	}
}

func (j *DueDigestJob) dueToRun() bool {
	now := j.now()
	if now.Hour() < DigestHour {
		return false
	}
	return j.lastRun != now.Format(time.DateOnly)
}
