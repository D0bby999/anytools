/**
 * Collector for Content-Security-Policy-Report-Only violations.
 *
 * Without an endpoint, a report-only CSP prints into each individual visitor's console and the
 * operator learns nothing — the header is decoration, and the "collect violations, then
 * enforce" plan in next.config.ts can never reach its second step.
 *
 * Deliberately minimal. This URL is public and unauthenticated by necessity (the browser posts
 * it without credentials), so it must be cheap and uninteresting to abuse:
 *   - always 204, never echoes input, never touches the database
 *   - body capped, so a large POST cannot be used to burn memory on a shared 4 GB box
 *   - one line per distinct blocked directive+URI, deduplicated in memory for the process
 *     lifetime, because a single crawler can otherwise emit thousands of identical reports
 */
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;
/** Distinct violations already logged. Bounded so a hostile client cannot grow it forever. */
const seen = new Set<string>();
const MAX_DISTINCT = 200;

type CspReport = {
  'csp-report'?: {
    'violated-directive'?: string;
    'blocked-uri'?: string;
    'document-uri'?: string;
  };
};

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 204 });

    const body = JSON.parse(raw) as CspReport;
    const report = body['csp-report'];
    if (!report) return new NextResponse(null, { status: 204 });

    const directive = report['violated-directive'] ?? 'unknown';
    const blocked = report['blocked-uri'] ?? 'unknown';
    // Origin only: a blocked-uri can carry a full path, and paths on this site can contain
    // things a log should not keep.
    let origin = blocked;
    try {
      origin = new URL(blocked).origin;
    } catch {
      /* inline/eval/data — already opaque */
    }

    const key = `${directive}|${origin}`;
    if (!seen.has(key) && seen.size < MAX_DISTINCT) {
      seen.add(key);
      console.warn(`[csp] ${directive} blocked ${origin}`);
    }
  } catch {
    // Malformed report. Nothing to do and nothing worth logging.
  }
  return new NextResponse(null, { status: 204 });
}
