package providers

import (
	"errors"
	"strings"
	"time"
)

// Error-class cooldowns for the BYOK fallback chain (ported from 9router's
// errorConfig ERROR_RULES). Text rules run BEFORE status rules — a 429 whose
// body says "invalid api key" is a credentials problem, not a rate limit.
const (
	cooldownCredentials   = 2 * time.Minute
	cooldownTransientBlip = 2 * time.Second // 502/503/504 — grace-eligible blip
	cooldownUnmatched     = 30 * time.Second
	rateLimitBase         = 2 * time.Second
	rateLimitCap          = 5 * time.Minute
	maxBackoffLevel       = 15
	// providerRetryAfterCap bounds a cooldown the PROVIDER asked for. Ported
	// from 9router's MAX_RATE_LIMIT_COOLDOWN_MS, whose comment names the reason:
	// "e.g. codex resets_at can be 5-6h".
	providerRetryAfterCap = 30 * time.Minute
)

// ErrorCooldown is the chain's verdict on a failed provider call.
type ErrorCooldown struct {
	Duration time.Duration
	// NewBackoffLevel is the level to persist (incremented for rate limits,
	// unchanged otherwise).
	NewBackoffLevel int
	// HTTPStatus is the extracted status (0 when the error carried none).
	HTTPStatus int
	// TransientBlip marks gateway-class failures (502/503/504) eligible for
	// the sleep-and-retry-same-entry grace instead of burning the connection.
	TransientBlip bool
	// FromRetryAfter reports that Duration came from the provider's Retry-After
	// header rather than our own backoff curve. Logged, because a 30-minute
	// cooldown is indistinguishable from a bug without it.
	FromRetryAfter bool
	// QuotaExhausted marks a PERIOD-quota exhaustion (the free tier / plan
	// allowance is spent for the day or month), distinct from a transient
	// per-minute rate limit. The chain uses it to bench the connection until its
	// known reset boundary instead of re-probing on the short rate-limit curve
	// (reset-aware cooldown, plan 260830-1313). Duration here is still the
	// rate-limit fallback — the chain overrides it when a reset cadence is known.
	QuotaExhausted bool
}

// rateLimitPhrases are TRANSIENT throttles (per-minute / capacity) — retry soon.
var rateLimitPhrases = []string{"rate limit", "rate_limit", "capacity", "overloaded"}

// quotaExhaustedPhrases mark a PERIOD allowance being spent (daily/monthly/free
// tier) — retry only after the tier resets. A match here still counts as
// rate-limited (so the short curve is the fallback when no reset cadence is
// known) but additionally sets ErrorCooldown.QuotaExhausted. "limit: 0" is
// Google/9router's "cut from the free tier" marker (see
// ~/.claude/rules/9router-media-api.md). Substrings are matched lower-cased.
var quotaExhaustedPhrases = []string{
	"quota exceeded", "insufficient quota", "usage limit reached", "exhausted your",
	"exhausted their", "daily limit", "monthly limit", "free tier", "free_tier",
	"limit: 0", "out of credits", "credit balance",
}

// ClassifyProviderError maps a provider call error to a cooldown for the
// failing connection. backoffLevel is the connection's persisted level BEFORE
// this failure.
func ClassifyProviderError(err error, backoffLevel int) ErrorCooldown {
	status := 0
	var httpErr *HTTPError
	if errors.As(err, &httpErr) {
		status = httpErr.Status
	}
	msg := ""
	if err != nil {
		msg = strings.ToLower(err.Error())
	}

	// Text rules first (9router ordering).
	if strings.Contains(msg, "no credentials") {
		return ErrorCooldown{Duration: cooldownCredentials, NewBackoffLevel: backoffLevel, HTTPStatus: status}
	}
	rateLimited := status == 429
	quotaExhausted := false
	for _, p := range quotaExhaustedPhrases {
		if strings.Contains(msg, p) {
			rateLimited = true
			quotaExhausted = true
			break
		}
	}
	if !quotaExhausted {
		for _, p := range rateLimitPhrases {
			if strings.Contains(msg, p) {
				rateLimited = true
				break
			}
		}
	}
	if rateLimited {
		level := backoffLevel
		if level < maxBackoffLevel {
			level++
		}
		d := rateLimitBase << (level - 1)
		if d > rateLimitCap || d <= 0 {
			d = rateLimitCap
		}

		// A provider that TELLS us when it recovers knows better than our
		// guess: without this, "come back in 45 minutes" is answered with a
		// 2-second backoff, and the chain spends a network round trip
		// relearning what the header already said — raising the backoff level
		// each time it does.
		//
		// Capped all the same, because the opposite extreme is worse: Codex can
		// report a 5-6h reset, and honouring that verbatim benches the
		// connection for the rest of the working day when the real allowance
		// usually returns sooner (or the customer tops up). 30 minutes is
		// 9router's MAX_RATE_LIMIT_COOLDOWN_MS, kept rather than re-derived.
		//
		// The level still advances: being told "wait 20 minutes" twice in a row
		// should cool the connection harder the third time, not reset it.
		if httpErr != nil && httpErr.RetryAfter > 0 {
			// The header may only EXTEND the wait, never shorten it. Letting it
			// win outright looks reasonable and quietly disables exponential
			// backoff: a provider answering every 429 with "Retry-After: 1"
			// would pin the cooldown at one second forever, and the chain would
			// re-hammer it once a second indefinitely while the backoff level
			// climbed with nothing reading it.
			ra := httpErr.RetryAfter
			// The 30-minute ceiling was justified by quota resets (Codex reports
			// 5-6h), so it applies to a real 429 only. A phrase-matched
			// "overloaded"/"capacity" error is a seconds-scale gateway blip;
			// giving it the same headroom would bench a healthy connection for
			// half an hour over a transient.
			cap := rateLimitCap
			if status == 429 {
				cap = providerRetryAfterCap
			}
			if ra > cap {
				ra = cap
			}
			if ra > d {
				return ErrorCooldown{
					Duration: ra, NewBackoffLevel: level, HTTPStatus: status,
					FromRetryAfter: true, QuotaExhausted: quotaExhausted,
				}
			}
		}
		return ErrorCooldown{Duration: d, NewBackoffLevel: level, HTTPStatus: status, QuotaExhausted: quotaExhausted}
	}

	switch status {
	case 401, 402, 403, 404:
		return ErrorCooldown{Duration: cooldownCredentials, NewBackoffLevel: backoffLevel, HTTPStatus: status}
	case 502, 503, 504:
		return ErrorCooldown{Duration: cooldownTransientBlip, NewBackoffLevel: backoffLevel, HTTPStatus: status, TransientBlip: true}
	}
	return ErrorCooldown{Duration: cooldownUnmatched, NewBackoffLevel: backoffLevel, HTTPStatus: status}
}
