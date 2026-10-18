package providers

import (
	"time"
)

// resetCooldownCap bounds a reset-aware bench so a mis-cadence (or a provider
// whose real reset is longer than a calendar day/month) can never park a
// connection indefinitely. 25h covers a daily reset even when the failure lands
// just after the previous boundary.
const resetCooldownCap = 25 * time.Hour

// NextResetCooldown returns how long to bench a quota-exhausted connection so it
// wakes at the next reset boundary for its cadence. ok=false for an unknown
// cadence (the caller then keeps the ordinary rate-limit curve).
//
// UTC only — no local time, no DST. now is injected for deterministic tests.
// Boundaries: "daily" → next 00:00 UTC; "monthly" → 00:00 UTC on the 1st of the
// next month. The result is capped at resetCooldownCap.
func NextResetCooldown(cadence string, now time.Time) (time.Duration, bool) {
	now = now.UTC()
	var boundary time.Time
	switch cadence {
	case "daily":
		// Start of tomorrow, UTC.
		t := now.AddDate(0, 0, 1)
		boundary = time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	case "monthly":
		// 1st of next month, UTC (December rolls into next January).
		year, month := now.Year(), now.Month()
		if month == time.December {
			year, month = year+1, time.January
		} else {
			month++
		}
		boundary = time.Date(year, month, 1, 0, 0, 0, 0, time.UTC)
	default:
		return 0, false
	}
	d := boundary.Sub(now)
	if d <= 0 {
		// Should not happen (boundary is always in the future), but never return
		// a non-positive cooldown.
		return 0, false
	}
	if d > resetCooldownCap {
		d = resetCooldownCap
	}
	return d, true
}

// CooldownReason maps a classified failure to the persisted reason string the
// UI uses to pick "resting" vs "quota — resets ~X" copy. Values match
// store.CooldownReason* by literal (providers must not import store).
func CooldownReason(cd ErrorCooldown) string {
	if cd.QuotaExhausted {
		return "quota"
	}
	return "rate_limit"
}

// ApplyQuotaResetCooldown is the single reset-aware override both fallback
// chains call after classifying a failure (DRY — byok_chain and
// media_provider_chain must not diverge). When the failure is a period-quota
// exhaustion AND the provider has a known reset cadence, it benches the
// connection until the next reset boundary instead of the short rate-limit
// curve. A provider-declared Retry-After that is LONGER than the reset estimate
// still wins (provider knows best; never shorter). No-op for a transient rate
// limit or an unknown cadence — the input cooldown passes through unchanged.
func ApplyQuotaResetCooldown(cd ErrorCooldown, providerType string, now time.Time) ErrorCooldown {
	if !cd.QuotaExhausted {
		return cd
	}
	reset, ok := NextResetCooldown(CadenceForProvider(providerType), now)
	if !ok {
		return cd // unknown cadence — keep the ordinary curve
	}
	if reset > cd.Duration {
		cd.Duration = reset
	}
	return cd
}
