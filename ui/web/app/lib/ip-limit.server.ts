/**
 * ip-limit.server.ts
 * A per-client-IP budget for the sign-in routes — the one place in the product
 * where there is no user yet to charge. Each callback ends in an identity
 * upsert on the API, so an unthrottled callback is an unthrottled account
 * write.
 *
 * The client IP is the RIGHTMOST X-Forwarded-For entry: nginx appends the
 * address it accepted the connection from ($proxy_add_x_forwarded_for), so
 * that entry is the one no client can forge; anything to its left is whatever
 * the client sent. Without the header (local development, no proxy) every
 * request shares one bucket, which the budget below is generous enough for.
 *
 * In-process, like the API's limiter: `web` is one process too.
 */
type Bucket = { tokens: number; at: number };

export function clientIP(request: Request): string {
  const forwarded = request.headers.get("X-Forwarded-For");
  if (!forwarded) return "unknown";
  const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.at(-1) ?? "unknown";
}

export function createIPLimiter(perMinute: number, burst: number, now: () => number = Date.now) {
  const buckets = new Map<string, Bucket>();
  const rate = perMinute / 60_000;

  return function allow(ip: string): boolean {
    const t = now();
    // Drop idle buckets so the map does not grow once per address ever seen.
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (t - b.at > 10 * 60_000) buckets.delete(k);
    }
    const b = buckets.get(ip) ?? { tokens: burst, at: t };
    b.tokens = Math.min(burst, b.tokens + (t - b.at) * rate);
    b.at = t;
    buckets.set(ip, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
}

/** Sign-in starts and callbacks, per IP: 30 a minute, bursts of 20. */
let signIn = createIPLimiter(30, 20);

/** Tests drive the callback many times from one "address"; each starts fresh. */
export function __resetSignInBudgetForTests(): void {
  signIn = createIPLimiter(30, 20);
}

/** Throws 429 when this client has used its sign-in budget. */
export function assertSignInBudget(request: Request): void {
  if (!signIn(clientIP(request))) {
    throw new Response("Too many sign-in attempts. Wait a minute and try again.", {
      status: 429,
      headers: { "Retry-After": "60", "Cache-Control": "no-store" },
    });
  }
}
