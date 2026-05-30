import { type NextRequest, NextResponse } from 'next/server';

// Currency converter backend. Uses Frankfurter (https://api.frankfurter.app)
// as the primary FX source: ECB-published rates, free, no API key, daily cadence.
// Falls back to Open Exchange Rates if OXR_APP_ID env var is set.
//
// Next.js fetch revalidates the upstream call every 86400s (24h). On Hetzner +
// Coolify (output: standalone) this writes to .next/cache/fetch-cache/. The
// cache is per-container so a redeploy clears it; that's acceptable for a free
// tier — Frankfurter has no quoted rate limits per IP for moderate usage.

const REVALIDATE_SECONDS = 86_400; // 24h

type Frankfurter = { amount: number; base: string; date: string; rates: Record<string, number> };

async function fetchFrankfurter(base: string): Promise<Frankfurter | null> {
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}`, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    return (await res.json()) as Frankfurter;
  } catch {
    return null;
  }
}

async function fetchOxr(base: string): Promise<Frankfurter | null> {
  const appId = process.env.OXR_APP_ID;
  if (!appId) return null;
  try {
    const res = await fetch(
      `https://openexchangerates.org/api/latest.json?app_id=${appId}&base=${encodeURIComponent(base)}`,
      { next: { revalidate: REVALIDATE_SECONDS } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      base: string;
      rates: Record<string, number>;
      timestamp: number;
    };
    return {
      amount: 1,
      base: data.base,
      date: new Date(data.timestamp * 1000).toISOString().slice(0, 10),
      rates: data.rates,
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const base = (req.nextUrl.searchParams.get('base') ?? 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(base)) {
    return NextResponse.json({ error: 'Invalid base currency' }, { status: 400 });
  }
  const data = (await fetchFrankfurter(base)) ?? (await fetchOxr(base));
  if (!data) {
    return NextResponse.json({ error: 'FX provider unavailable' }, { status: 503 });
  }
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=43200`,
    },
  });
}
