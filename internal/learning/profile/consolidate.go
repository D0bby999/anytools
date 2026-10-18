package profile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/capabilities/modeljson"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/learning"
	profileprompts "github.com/D0bby999/anytools/internal/prompts/profile"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/tools"
)

// consolidate.go is the nightly consolidation: one model call per opted-in
// learner per night, at 02:00 in the learner's zone, and only after new
// activity.
//
// It is OFF until the learner turns it on (owner's decision, 2026-09-27), and
// what it produces are proposals the learner approves in Settings. The call
// uses the learner's own `chat` route; a learner with nothing routed is
// skipped, never served by anything else.
//
// Advisory-locked for the reason due_digest_job.go gives (red team RT-8): two
// processes both deciding it is 02:00 must not both bill the learner.

// ConsolidateLock is the advisory-lock name the job holds while it runs.
const ConsolidateLock = "profile-consolidate"

// ConsolidateHour is the local hour a learner's pass becomes due.
const ConsolidateHour = 2

// modelFunction is the BYOK route the call uses.
const modelFunction = "chat"

// Learner is one opted-in learner the job visits.
type Learner struct {
	UserID uuid.UUID
	Zone   string
	// LastStarted is the newest run of any outcome; LastSucceeded the newest
	// run that reached the model. Both nil before the first.
	LastStarted   *time.Time
	LastSucceeded *time.Time
}

// RunResult is what a finished run writes, in one transaction.
type RunResult struct {
	Status    string
	Ops       []RunOp
	Error     string
	Model     string
	Proposals []Proposal
}

// ConsolidationStore is what the job reads and writes. OptedIn spans users —
// which is exactly why the caller is locked; everything after it is called
// with one learner's id.
type ConsolidationStore interface {
	OptedIn(ctx context.Context) ([]Learner, error)
	// HasActivity reports any answer, explain-back, vocabulary review, skill
	// card entry or mastery event at or after since.
	HasActivity(ctx context.Context, userID uuid.UUID, since time.Time) (bool, error)
	SignalRows(ctx context.Context, userID uuid.UUID, since time.Time) (SignalRows, error)
	// Current is the accepted consolidated entries (shown to the model), the
	// accepted count and folded texts per section, the proposals rejected
	// within the cooldown, and the learner's Loop goals.
	Current(ctx context.Context, userID uuid.UUID, now time.Time) (*Current, error)
	StartRun(ctx context.Context, userID uuid.UUID, now time.Time) (uuid.UUID, error)
	// FinishRun records the outcome. On success it withdraws the learner's
	// earlier unreviewed proposals, stores the new ones, and forgets
	// rejections older than the cooldown — all in one transaction.
	FinishRun(ctx context.Context, userID, runID uuid.UUID, res RunResult, now time.Time) error
}

// Current is the profile as the consolidation sees it.
type Current struct {
	Consolidated []Entry
	// ConsolidatedRefs are each consolidated entry's stored refs, by id.
	ConsolidatedRefs map[uuid.UUID][]Ref
	Accepted         map[string]int
	Texts            map[string][]string
	Rejected         []Rejected
	Goals            []string
}

// Job is the nightly consolidation pass.
type Job struct {
	pool   *pgxpool.Pool
	store  ConsolidationStore
	models runtime.ChatProviderResolver
	now    func() time.Time
}

// NewJob builds the job.
func NewJob(pool *pgxpool.Pool, store ConsolidationStore, models runtime.ChatProviderResolver) *Job {
	return &Job{pool: pool, store: store, models: models, now: time.Now}
}

// SetClock overrides the job's clock. Tests use it; production does not.
func (j *Job) SetClock(now func() time.Time) { j.now = now }

// Due reports whether a learner's pass is due at now: it is past 02:00 on
// their local calendar day, and no run has started since.
func Due(now time.Time, zone string, lastStarted *time.Time) bool {
	at := learning.StartOf(learning.LocalDay(now, zone), zone).Add(ConsolidateHour * time.Hour)
	if now.Before(at) {
		return false
	}
	return lastStarted == nil || lastStarted.Before(at)
}

// RunOnce makes one pass holding the advisory lock. ran=false, with no error,
// means another process held it.
func (j *Job) RunOnce(ctx context.Context) (visited int, ran bool, err error) {
	ran, err = jobs.WithAdvisoryLock(ctx, j.pool, ConsolidateLock, func(ctx context.Context) error {
		learners, err := j.store.OptedIn(ctx)
		if err != nil {
			return err
		}
		for _, l := range learners {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if !Due(j.now(), l.Zone, l.LastStarted) {
				continue
			}
			if err := j.consolidate(ctx, l); err != nil {
				// One learner's failure must not cost everyone else their
				// pass. Logged; tomorrow night tries again.
				slog.Warn("profile: consolidation failed", "user", l.UserID, "error", err)
			}
			visited++
		}
		return nil
	})
	return visited, ran, err
}

// consolidate is one learner's run. The run row is written first, so every
// outcome — skipped included — is recorded and the learner is not asked
// again until tomorrow.
func (j *Job) consolidate(ctx context.Context, l Learner) error {
	now := j.now().UTC()
	runID, err := j.store.StartRun(ctx, l.UserID, now)
	if err != nil {
		return err
	}
	finish := func(res RunResult) error {
		return j.store.FinishRun(context.WithoutCancel(ctx), l.UserID, runID, res, j.now().UTC())
	}

	since := now.Add(-SignalWindow)
	if l.LastSucceeded != nil {
		since = *l.LastSucceeded
	}
	active, err := j.store.HasActivity(ctx, l.UserID, since)
	if err != nil {
		_ = finish(RunResult{Status: RunFailed, Error: "could not read activity"})
		return err
	}
	if !active {
		return finish(RunResult{Status: RunSkipped, Error: "no new activity since the last run"})
	}

	provider, err := j.models.ChatFor(ctx, l.UserID, modelFunction)
	if errors.Is(err, runtime.ErrNoProvider) {
		return finish(RunResult{Status: RunSkipped, Error: "no model is routed for chat"})
	}
	if err != nil {
		_ = finish(RunResult{Status: RunFailed, Error: "could not resolve your chat model"})
		return err
	}
	model := provider.DefaultModel()

	rows, err := j.store.SignalRows(ctx, l.UserID, now.Add(-SignalWindow))
	if err != nil {
		_ = finish(RunResult{Status: RunFailed, Error: "could not read activity"})
		return err
	}
	signals := BuildSignals(rows)
	if signals.Empty() {
		return finish(RunResult{Status: RunSkipped, Error: "nothing to consolidate from"})
	}
	cur, err := j.store.Current(ctx, l.UserID, now)
	if err != nil {
		_ = finish(RunResult{Status: RunFailed, Error: "could not read the profile"})
		return err
	}
	keyed := keyEntries(cur)

	ops, err := j.ask(ctx, provider, model, signals, keyed)
	if err != nil {
		_ = finish(RunResult{Status: RunFailed, Model: model, Error: err.Error()})
		return nil
	}
	props, log := Check(ops, GuardInput{
		Signals: signals, Entries: keyed, Accepted: cur.Accepted, Texts: cur.Texts,
		Rejected: cur.Rejected, Goals: cur.Goals, Now: now,
	})
	return finish(RunResult{Status: RunSucceeded, Model: model, Ops: log, Proposals: props})
}

// keyEntries gives each consolidated entry the key the model sees it under.
// The learner's own entries are not in cur.Consolidated, so they have no key
// and no operation can name them.
func keyEntries(cur *Current) []Keyed {
	out := make([]Keyed, 0, len(cur.Consolidated))
	for i, e := range cur.Consolidated {
		if e.Origin != OriginConsolidated {
			continue
		}
		out = append(out, Keyed{Key: fmt.Sprintf("E%d", i+1), Entry: e, Refs: cur.ConsolidatedRefs[e.ID]})
	}
	return out
}

// Input is the user message of the consolidation call: the signals, then the
// current consolidated statements, each quoted as untrusted text.
func Input(signals *Signals, keyed []Keyed) string {
	var b strings.Builder
	b.WriteString("Signals:\n\n")
	b.WriteString(signals.Render())
	b.WriteString("\n\nCurrent statements from earlier runs:\n\n")
	if len(keyed) == 0 {
		b.WriteString("(none)\n")
	}
	for _, k := range keyed {
		fmt.Fprintf(&b, "%s — section %s:\n%s\n", k.Key, k.Entry.Section,
			tools.Wrap("profile statement", "profile:"+k.Entry.ID.String(), k.Entry.Text))
	}
	return strings.TrimSpace(b.String())
}

// ask makes the one call. An unreadable reply is an error the run records;
// nothing is proposed from it.
func (j *Job) ask(ctx context.Context, provider runtime.ChatProvider, model string, signals *Signals, keyed []Keyed) ([]RawOp, error) {
	resp, err := provider.Chat(ctx, runtime.ChatRequest{
		Model: model,
		Messages: []runtime.Message{
			{Role: runtime.RoleSystem, Content: profileprompts.Consolidate},
			{Role: runtime.RoleUser, Content: Input(signals, keyed)},
		},
	})
	if err != nil {
		return nil, errors.New("your model could not be reached")
	}
	if resp == nil {
		return nil, errors.New("your model returned nothing")
	}
	payload, ok := modeljson.Extract(resp.Content)
	if !ok {
		return nil, errors.New("your model's reply had no JSON in it")
	}
	var reply struct {
		Operations []RawOp `json:"operations"`
	}
	if err := json.Unmarshal([]byte(payload), &reply); err != nil {
		return nil, errors.New("your model's reply could not be read")
	}
	return reply.Operations, nil
}

// TickEvery is how often the job looks for learners whose 02:00 has come.
const TickEvery = 15 * time.Minute

// Start runs passes on a fixed tick until ctx ends. Each pass visits only the
// learners whose local 02:00 has passed since their last run, so the tick can
// be frequent without anyone being consolidated twice.
func (j *Job) Start(ctx context.Context) {
	ticker := time.NewTicker(TickEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			n, ran, err := j.RunOnce(ctx)
			switch {
			case err != nil:
				slog.Error("profile: consolidation pass failed", "error", err)
			case ran && n > 0:
				slog.Info("profile: consolidation pass", "learners", n)
			}
		}
	}
}
