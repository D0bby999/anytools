package byok

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/store"
)

// chain.go — one fallback chain, generic over what it is a chain OF.
//
// Ported in behaviour from postclaw internal/agent/byok_chain.go:140-360, with
// one change that matters: postclaw has a chat chain and a separate, divergent
// copy for media. AnyTools has Chain[T], so the cooldown curve, the
// transient-blip grace and the verify write-back are written once and apply
// identically to chat, parse, embed and search. A fix to any of them cannot
// land in one lane and not the others.

// ErrNoRoute is returned when the user has not routed this function at all.
// Distinct from ErrAllEntriesFailed because the remedies differ: one is "go to
// Settings", the other is "your providers are down".
var ErrNoRoute = errors.New("byok: no connection is routed to this function")

// ErrStopChain marks a failure that must NOT be retried on the next entry.
//
// It exists for exactly one caller and one reason: a streamed chat call that
// has already delivered content to the browser. The chain's normal answer to a
// failure is "try the next connection", but a second lane starts its answer
// from the top, and the reader is already looking at the first one — the turn
// would show two answers spliced together and there is no frame that means
// "discard what I just said". Wrapping the error in this sentinel keeps the
// failure classified and benched exactly as any other, and stops the walk.
//
// The entry that failed is still recorded, so nothing about cooldowns changes.
var ErrStopChain = errors.New("byok: do not try further connections")

// ErrAllEntriesFailed is returned when every entry in the chain failed or was
// cooling down. It wraps the LAST underlying error so a caller can still
// classify it.
type ErrAllEntriesFailed struct {
	Function string
	Tried    int
	Skipped  int
	Last     error
}

func (e *ErrAllEntriesFailed) Error() string {
	if e.Last == nil {
		return fmt.Sprintf("byok: every %s entry is cooling down (%d skipped)", e.Function, e.Skipped)
	}
	return fmt.Sprintf("byok: all %d %s entries failed (%d skipped for cooldown): %v",
		e.Tried, e.Function, e.Skipped, e.Last)
}

func (e *ErrAllEntriesFailed) Unwrap() error { return e.Last }

// Entry is one link of a chain: a client, plus the connection it came from.
type Entry[T any] struct {
	Client       T
	ConnectionID uuid.UUID
	Provider     string
	Name         string
	Model        string
	Position     int
	Settings     store.ConnectionSettings
}

// settingsWriter is the narrow slice of the connection store a chain needs. It
// is an interface rather than the concrete store so the chain's own tests do not
// need a database to prove the cooldown arithmetic — but the persistence test
// that matters (a cooldown surviving a restart) uses the real one, because an
// in-memory fake cannot fail the way a forgotten UPDATE can.
type settingsWriter interface {
	MergeConnectionSettings(ctx context.Context, userID, id uuid.UUID, patch json.RawMessage) error
}

// Chain walks a user's routed connections until one succeeds.
type Chain[T any] struct {
	Function string
	entries  []Entry[T]
	// unbuildable counts routed entries that could not be turned into a client
	// at all — a disabled lane, or a provider with no client for this function.
	// They are not in `entries`, so without this the chain would report
	// ErrNoRoute for a function the user HAS configured, which sends them
	// looking for a missing route rather than a broken one.
	unbuildable int
	userID      uuid.UUID
	store       settingsWriter
	now         func() time.Time
	sleep       func(time.Duration)
}

// Unbuildable reports how many routed entries were dropped during resolution.
func (c *Chain[T]) Unbuildable() int { return c.unbuildable }

// Entries exposes the resolved chain for readiness and for tests. It does not
// expose secrets: Entry carries a built client, never a key.
func (c *Chain[T]) Entries() []Entry[T] { return c.entries }

// Prefer moves one entry to the front, keeping the others in their order
// behind it: the entry for connectionID and model, or with model "" the
// connection's first entry (a route may hold one connection twice, with two
// models). It reports whether such an entry was on the chain.
func (c *Chain[T]) Prefer(connectionID uuid.UUID, model string) bool {
	for i, e := range c.entries {
		if e.ConnectionID == connectionID && (model == "" || e.Model == model) {
			reordered := make([]Entry[T], 0, len(c.entries))
			reordered = append(reordered, e)
			reordered = append(reordered, c.entries[:i]...)
			reordered = append(reordered, c.entries[i+1:]...)
			c.entries = reordered
			return true
		}
	}
	return false
}

// Len reports how many entries the chain has.
func (c *Chain[T]) Len() int { return len(c.entries) }

// transientGrace is how long the chain waits before re-trying the SAME entry
// after a gateway-class blip (502/503/504). Short, because the point is to ride
// out a one-second hiccup rather than to retry properly — that is RetryDo's job
// inside the provider client. Without it, a load balancer restarting upstream
// burns the user's first-choice connection for two minutes.
const transientGrace = 2 * time.Second

// Do walls the chain, calling fn with each entry's client until one succeeds.
//
// The rules, all of them ported from the source chain because each was learned
// from a real failure:
//
//   - An entry whose persisted cooldown has not expired is SKIPPED without a
//     network call. This is what makes the cooldown worth persisting.
//   - A failure is classified (providers.ClassifyProviderError) and the
//     resulting cooldown is written back to that connection's settings before
//     moving on, so a restart does not resurrect it.
//   - A transient blip gets ONE sleep-and-retry on the same entry before the
//     chain gives up on it, because burning a healthy connection over a gateway
//     restart is worse than a two-second pause.
//   - A success clears the cooldown and records verify_status=verified. A
//     connection that just answered is verified by definition, and not writing
//     that back means the UI keeps showing "unverified" for a key doing real work.
func (c *Chain[T]) Do(ctx context.Context, fn func(ctx context.Context, client T, entry Entry[T]) error) error {
	if len(c.entries) == 0 {
		if c.unbuildable > 0 {
			return &ErrAllEntriesFailed{Function: c.Function, Skipped: c.unbuildable}
		}
		return ErrNoRoute
	}

	var (
		lastErr error
		tried   int
		skipped int
	)

	for i := range c.entries {
		entry := c.entries[i]

		if entry.Settings.CoolingDownAt(c.now()) {
			skipped++
			slog.Debug("byok: skipping connection on cooldown",
				"function", c.Function, "connection", entry.ConnectionID,
				"until", entry.Settings.CooldownUntil, "reason", entry.Settings.CooldownReason)
			continue
		}

		// A cancelled request must not keep walking the chain: every further
		// entry would fail on the same cancelled context and each would be
		// benched for a failure that was ours, not theirs.
		if ctx.Err() != nil {
			return ctx.Err()
		}

		tried++
		err := fn(ctx, entry.Client, entry)
		if err == nil {
			c.recordSuccess(ctx, entry)
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}

		cooldown := providers.ClassifyProviderError(err, entry.Settings.BackoffLevel)
		cooldown = providers.ApplyQuotaResetCooldown(cooldown, entry.Provider, c.now())

		// A committed failure gets no same-entry retry either: the blip grace
		// calls fn a SECOND time, which would replay the answer into a stream
		// the reader is already watching.
		if cooldown.TransientBlip && !errors.Is(err, ErrStopChain) {
			slog.Warn("byok: transient provider blip, retrying the same connection once",
				"function", c.Function, "connection", entry.ConnectionID,
				"status", cooldown.HTTPStatus, "grace", transientGrace)
			if !c.wait(ctx, transientGrace) {
				return ctx.Err()
			}
			err2 := fn(ctx, entry.Client, entry)
			if err2 == nil {
				c.recordSuccess(ctx, entry)
				return nil
			}
			// The blip did not clear. Reclassify on the SECOND failure: a 503
			// followed by a 401 is a credentials problem, and benching it on the
			// two-second gateway curve would re-probe a dead key every few
			// seconds for as long as the user kept asking.
			err = err2
			cooldown = providers.ClassifyProviderError(err, entry.Settings.BackoffLevel)
			cooldown = providers.ApplyQuotaResetCooldown(cooldown, entry.Provider, c.now())
		}

		lastErr = err
		c.recordFailure(ctx, entry, cooldown, err)

		if errors.Is(err, ErrStopChain) {
			// The caller has already committed this failure to something the
			// user can see. Benching the entry (above) still happens; walking
			// on does not.
			return &ErrAllEntriesFailed{Function: c.Function, Tried: tried, Skipped: skipped, Last: lastErr}
		}
	}

	return &ErrAllEntriesFailed{Function: c.Function, Tried: tried, Skipped: skipped, Last: lastErr}
}

// wait sleeps, or returns false when the context ended first.
func (c *Chain[T]) wait(ctx context.Context, d time.Duration) bool {
	if c.sleep != nil { // tests inject a no-op so the suite does not actually pause
		c.sleep(d)
		return ctx.Err() == nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

// recordSuccess clears the cooldown and marks the connection verified.
//
// Written with an explicit JSON null for cooldown_until rather than by omitting
// the key: the store's merge is `settings || patch`, so an omitted key leaves
// the OLD value in place and the connection would stay benched after answering
// successfully.
func (c *Chain[T]) recordSuccess(ctx context.Context, entry Entry[T]) {
	patch := map[string]any{
		"cooldown_until":  nil,
		"backoff_level":   0,
		"cooldown_reason": "",
		"verify_status":   store.VerifyStatusVerified,
	}
	c.mergeSettings(ctx, entry, patch)
}

func (c *Chain[T]) recordFailure(ctx context.Context, entry Entry[T], cd providers.ErrorCooldown, err error) {
	until := c.now().Add(cd.Duration)
	slog.Warn("byok: connection failed, benching it",
		"function", c.Function, "connection", entry.ConnectionID, "provider", entry.Provider,
		"status", cd.HTTPStatus, "cooldown", cd.Duration, "until", until,
		"from_retry_after", cd.FromRetryAfter, "quota_exhausted", cd.QuotaExhausted,
		// The error text can contain a provider's echo of the request. It is
		// classified above and logged at debug only, never at warn, and never
		// into a response body.
		"error_class", providers.CooldownReason(cd))
	slog.Debug("byok: connection failure detail", "connection", entry.ConnectionID, "error", err.Error())

	c.mergeSettings(ctx, entry, map[string]any{
		"cooldown_until":  until,
		"backoff_level":   cd.NewBackoffLevel,
		"cooldown_reason": providers.CooldownReason(cd),
		"verify_status":   store.VerifyStatusFailed,
	})
}

// mergeSettings persists a settings patch on a DETACHED context.
//
// Deliberate: the common reason a chain entry fails is that the caller's
// context was cancelled or timed out, and that is exactly when the cooldown
// most needs to be written. Using the dying context here would drop the write
// precisely in the case it matters.
func (c *Chain[T]) mergeSettings(ctx context.Context, entry Entry[T], patch map[string]any) {
	raw, err := json.Marshal(patch)
	if err != nil {
		slog.Error("byok: marshal settings patch", "error", err)
		return
	}
	writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := c.store.MergeConnectionSettings(writeCtx, c.userID, entry.ConnectionID, raw); err != nil {
		// Failing to persist a cooldown is not a reason to fail the user's
		// request — the chain already has an answer or a real error to return.
		// It is a reason to be loud, because the next call will re-probe a
		// provider that just refused.
		slog.Error("byok: could not persist connection state",
			"connection", entry.ConnectionID, "error", err)
	}
}
