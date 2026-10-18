/**
 * session-watermark.server.ts
 * Session-revocation check for the BFF.
 *
 * Phase 1 ships the seam, not the feature. AnyTools has no password reset yet,
 * so there is nothing that bumps a watermark — but "log out everywhere" and
 * account deletion (phase 11) both need this hook, and retrofitting a
 * revocation check into every loader later is how it gets missed in one.
 *
 * Fail-OPEN is deliberate and bounded: this is defense in depth ON TOP of the
 * cookie's own signature and expiry, not the only gate. An API hiccup must not
 * log out every user at once. postclaw's equivalent had the same posture and
 * the same warning — and one lesson attached: a missing gateway token there
 * silently disabled revocation PERMANENTLY with only a console line to say so.
 * AnyTools' env.server.ts makes that token required in production instead.
 */
import { apiFetch } from "~/lib/api.server";

const CACHE_TTL_MS = 60_000;

/**
 * The watermark is stamped by the API's clock and compared against a `sat`
 * stamped by this process's clock. A session minted the same second a
 * revocation happens must not be treated as stale by a hair.
 */
const CLOCK_SKEW_TOLERANCE_SECONDS = 5;

type CacheEntry = { validAfter: number | null; fetchedAt: number };
const cache = new Map<string, CacheEntry>();

/**
 * True only when a watermark exists AND this session predates it.
 *
 * A session with no `sat` is treated as valid: there is nothing to compare it
 * against, and force-logging out every existing user on deploy would be its own
 * incident.
 */
export async function isSessionRevoked(userId: string, sat: number | undefined): Promise<boolean> {
  if (!sat) return false;

  const watermark = await fetchWatermark(userId);
  if (watermark === null) return false;

  return sat < watermark - CLOCK_SKEW_TOLERANCE_SECONDS;
}

async function fetchWatermark(userId: string): Promise<number | null> {
  const cached = cache.get(userId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.validAfter;

  try {
    const res = await apiFetch<{ sessions_valid_after: number | null }>(
      "/v1/auth/session-watermark",
      userId,
    );
    const value = typeof res.sessions_valid_after === "number" ? res.sessions_valid_after : null;
    cache.set(userId, { validAfter: value, fetchedAt: Date.now() });
    return value;
  } catch {
    // The API is briefly unreachable. Keep the last KNOWN watermark rather
    // than forgetting it: caching null here would re-admit a revoked session
    // for a minute every time the API blinked. A user never revoked has no
    // watermark to keep, so for them this is fail-open, as before; the cache
    // entry stops a failing API from costing one round trip per request.
    const known = cached?.validAfter ?? null;
    cache.set(userId, { validAfter: known, fetchedAt: Date.now() });
    return known;
  }
}

/** Ends every session of this user minted before now (sign-out). */
export async function revokeSessions(userId: string): Promise<void> {
  await apiFetch<{ sessions_valid_after: number }>("/v1/auth/session-watermark", userId, {
    method: "POST",
    body: {},
  });
  cache.delete(userId);
}

/** Drops a user's cached watermark so the next check re-reads it. */
export function invalidateWatermark(userId: string) {
  cache.delete(userId);
}

/** Clears the whole cache. Tests only. */
export function __clearWatermarkCacheForTests() {
  cache.clear();
}
