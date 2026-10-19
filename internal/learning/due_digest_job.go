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

// DigestHour is the default local hour of a learner's reminder (they can pick
// another in Settings → Reminders).
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
// The job calls it every hour for every learner with something due; the
// notifier decides whether this is that learner's hour. internal/push is the
// production one: a web push at the learner's local reminder hour, at most once
// a day, and only to browsers they turned reminders on in. LogNotifier is the
// default for a job built without one.
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
		return nil
	})
	return sent, ran, err
}

// Start runs a pass every hour.
//
// Hourly because learners live in different zones and pick their own hour: each
// pass offers every learner with something due to the notifier, which sends
// only in that learner's hour and only once on their local day (the day it
// sent is stored, so a restart cannot send it twice). A 24-hour timer started
// at boot would also drift with every deploy; an hourly tick cannot.
func (j *DueDigestJob) Start(ctx context.Context) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
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
