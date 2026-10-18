/**
 * same-origin.server.ts
 * The BFF's CSRF defence for every state-changing request.
 *
 * Two layers. The session cookie is SameSite=Lax, so a cross-site form POST
 * arrives without it. This is the second: a write whose `Origin` names another
 * site is refused BEFORE any action runs, even if a browser quirk or a
 * same-site subdomain delivered the cookie. It is called from getUserId, the one
 * function every action reaches its user through, so no action can skip it.
 *
 * An Origin check rather than a synchronizer token: every browser that can hold
 * our cookie sends Origin on POST (Fetch spec), the check needs no state, and a
 * form rendered by the server needs no hidden field it could forget. OWASP lists
 * it as a primary defence alongside tokens.
 */
import { APP_URL } from "~/lib/env.server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Why a request was refused, or null when it may proceed. */
export function crossSiteWriteReason(request: Request): string | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;

  const origin = request.headers.get("Origin");
  if (origin !== null) {
    if (origin === "null") return "opaque origin";
    let originURL: URL;
    try {
      originURL = new URL(origin);
    } catch {
      return "malformed origin";
    }
    // The request's own Host: in a forged request it is still OUR host (the
    // browser sets it), while Origin is the attacker's page. Comparing the two
    // also works on a dev port, where APP_URL names a different one.
    const host = request.headers.get("Host");
    if (host && originURL.host === host) return null;
    if (originURL.origin === new URL(APP_URL).origin) return null;
    return `origin ${originURL.origin} is not this site`;
  }

  // No Origin: an old client, or a non-browser one (which cannot hold a
  // victim's cookie). Fetch metadata, when present, is still decisive.
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") return `sec-fetch-site ${site}`;
  return null;
}

/** Throws 403 for a cross-site write. */
export function assertSameOrigin(request: Request): void {
  const reason = crossSiteWriteReason(request);
  if (reason) {
    throw new Response("Cross-site request refused.", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
}
