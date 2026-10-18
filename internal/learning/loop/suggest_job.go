package loop

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/jobs"
)

// suggest_job.go proposes evidence for each active cycle's current week, so
// the suggestions are waiting when a person opens their weekly review.
//
// It PROPOSES; it never accepts. Every row it writes is status `suggested`,
// inserted with ON CONFLICT DO NOTHING, so a suggestion the person already
// accepted or dismissed is never touched and a dismissed one is not proposed
// again the next night. Gates count accepted refs only (gates.go), so nothing
// this job does can open a gate.
//
// It reads phases 6–9's tables through the same Candidates query the
// GET /v1/learning/evidence/suggest endpoint uses, so what the job proposes at
// night and what the page shows live cannot disagree.
//
// Advisory-locked for the reason due_digest_job.go gives (red-team RT-8): two
// processes both deciding it is 03:00 must not both run. The unique index
// makes a double run harmless to the data; the lock makes it not happen.

// SuggestLock is the advisory-lock name the job holds while it runs.
const SuggestLock = "loop-evidence-suggest"

// SuggestHour is the local hour the nightly pass runs at.
const SuggestHour = 3

// ActiveCycle is one cycle the job visits.
type ActiveCycle struct {
	UserID    uuid.UUID
	CycleID   uuid.UUID
	StateID   uuid.UUID
	StartedAt time.Time
}

// SuggestSource is what the job reads and writes. It is NOT user-scoped at the
// top — ActiveCycles spans users — which is exactly why the caller is locked.
// Everything after that is called with the cycle's own user id.
type SuggestSource interface {
	// ActiveCycles lists each state's current cycle that has not reached its
	// last phase.
	ActiveCycles(ctx context.Context) ([]ActiveCycle, error)
	// EnsureReview returns the id of a cycle's review for week, creating it.
	EnsureReview(ctx context.Context, userID, cycleID uuid.UUID, week int) (uuid.UUID, error)
	Candidates(ctx context.Context, userID, stateID uuid.UUID, from, to time.Time) ([]Candidate, error)
	// InsertSuggestion writes a `suggested` ref unless one for the same target
	// is already on the review, reporting whether it wrote.
	InsertSuggestion(ctx context.Context, userID, reviewID uuid.UUID, c Candidate) (bool, error)
}

// SuggestJob is the nightly suggestion pass.
type SuggestJob struct {
	pool    *pgxpool.Pool
	source  SuggestSource
	now     func() time.Time
	lastRun string
}

// NewSuggestJob builds the job.
func NewSuggestJob(pool *pgxpool.Pool, source SuggestSource) *SuggestJob {
	return &SuggestJob{pool: pool, source: source, now: time.Now}
}

// SetClock overrides the job's clock. Tests use it; production does not.
func (j *SuggestJob) SetClock(now func() time.Time) { j.now = now }

// RunOnce makes one pass holding the advisory lock. ran=false, with no error,
// means another process held it — the pass is happening, just not here.
func (j *SuggestJob) RunOnce(ctx context.Context) (suggested int, ran bool, err error) {
	ran, err = jobs.WithAdvisoryLock(ctx, j.pool, SuggestLock, func(ctx context.Context) error {
		now := j.now().UTC()
		cycles, err := j.source.ActiveCycles(ctx)
		if err != nil {
			return err
		}
		for _, c := range cycles {
			n, err := j.suggestFor(ctx, c, now)
			if err != nil {
				// One user's failure must not cost everyone else their
				// suggestions. Logged; the next night retries it.
				slog.Warn("loop: evidence suggestion failed", "user", c.UserID, "cycle", c.CycleID, "error", err)
				continue
			}
			suggested += n
		}
		j.lastRun = j.now().Format(time.DateOnly)
		return nil
	})
	return suggested, ran, err
}

func (j *SuggestJob) suggestFor(ctx context.Context, c ActiveCycle, now time.Time) (int, error) {
	week := WeekOf(c.StartedAt, now)
	from, to := WeekWindow(c.StartedAt, week)
	cands, err := j.source.Candidates(ctx, c.UserID, c.StateID, from, to)
	if err != nil || len(cands) == 0 {
		// No activity, no empty review: a row for a week nobody worked would
		// be a review the person has to dismiss.
		return 0, err
	}
	reviewID, err := j.source.EnsureReview(ctx, c.UserID, c.CycleID, week)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, cand := range cands {
		wrote, err := j.source.InsertSuggestion(ctx, c.UserID, reviewID, cand)
		if err != nil {
			return n, err
		}
		if wrote {
			n++
		}
	}
	return n, nil
}

// Start runs the pass once a day at SuggestHour, on an hourly tick that
// cannot drift (see DueDigestJob.Start).
func (j *SuggestJob) Start(ctx context.Context) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			now := j.now()
			if now.Hour() < SuggestHour || j.lastRun == now.Format(time.DateOnly) {
				continue
			}
			n, ran, err := j.RunOnce(ctx)
			switch {
			case err != nil:
				slog.Error("loop: evidence suggestion pass failed", "error", err)
			case ran:
				slog.Info("loop: evidence suggested", "refs", n)
			}
		}
	}
}
