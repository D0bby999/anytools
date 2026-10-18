/**
 * tools/fx.server.ts
 * Exchange rates for the currency-converter tool (routes/api.fx.ts), from
 * Frankfurter: rates the European Central Bank publishes, free, with no key.
 *
 * The old site fetched https://api.frankfurter.app/latest, cached for a day.
 * That address now answers 301 to the URL below, which returns the same
 * shape, so this calls it directly and follows no redirect. Its fallback
 * (Open Exchange Rates on a server-held app id) is not carried over: this
 * product holds no platform keys.
 *
 * One day per base currency in this process's memory, like the old fetch
 * cache. Only well-formed answers are kept, and only a bounded number.
 */
import { readTextLimited } from "./bounded-read.server";

export const FRANKFURTER_LATEST = "https://api.frankfurter.dev/v1/latest";

export const FX_TTL_MS = 24 * 60 * 60 * 1000;
/** Frankfurter quotes about thirty currencies; anything else is a 404 and never cached. */
const MAX_CACHED = 64;
/** A real answer is about 600 bytes. */
const MAX_UPSTREAM_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 10_000;

export type FxRates = { amount: number; base: string; date: string; rates: Record<string, number> };

const cache = new Map<string, { at: number; data: FxRates }>();

export function __clearFxCacheForTests(): void {
  cache.clear();
}

export function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

function parseRates(text: string): FxRates | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const { amount, base, date, rates } = raw as Record<string, unknown>;
  if (typeof base !== "string" || !isCurrencyCode(base)) return null;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!rates || typeof rates !== "object" || Array.isArray(rates)) return null;
  const clean: Record<string, number> = {};
  for (const [code, value] of Object.entries(rates)) {
    if (!isCurrencyCode(code) || typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
    clean[code] = value;
  }
  return { amount: typeof amount === "number" && Number.isFinite(amount) ? amount : 1, base, date, rates: clean };
}

/** The day's rates for `base` (already validated), or null when Frankfurter cannot say. */
export async function fxRates(base: string, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Promise<FxRates | null> {
  const hit = cache.get(base);
  if (hit && now() - hit.at < FX_TTL_MS) return hit.data;

  let data: FxRates | null = null;
  try {
    const res = await fetchImpl(`${FRANKFURTER_LATEST}?from=${encodeURIComponent(base)}`, {
      redirect: "error",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (res.ok) data = parseRates(await readTextLimited(res.body, MAX_UPSTREAM_BYTES));
    else await res.body?.cancel();
  } catch {
    data = null;
  }
  if (!data) return hit?.data ?? null;

  if (!cache.has(base) && cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(base, { at: now(), data });
  return data;
}
