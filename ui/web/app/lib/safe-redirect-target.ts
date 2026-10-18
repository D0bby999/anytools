/**
 * safe-redirect-target.ts
 * Validates a "?next=" post-login redirect target.
 *
 * Only a same-origin relative path is allowed. Everything rejected here is a
 * way to send the browser off-domain immediately after a successful login,
 * which is a credible phishing sequence: the user completes a real sign-in and
 * lands on an attacker's page still believing they are inside the app.
 *
 * Rejected:
 *   - protocol-relative URLs ("//evil.test") - no scheme of their own, but they
 *     resolve against the current one, so they ARE absolute cross-origin URLs
 *   - backslash-prefixed paths - some browsers normalize the
 *     leading backslash to "/", producing the protocol-relative case above
 *   - anything with an explicit scheme ("https://evil.test", "javascript:...")
 *     - these never start with "/", so the leading-slash test rejects them
 *   - control characters, which can split a header if the value is ever
 *     interpolated into a raw redirect
 */
const MAX_LENGTH = 2048;

/** `/path` only - not `//host`, not a backslash-prefixed host, no scheme, no control chars. */
const SAFE_RELATIVE_PATH = /^\/(?!\/|\\)/;
const HAS_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Returns `raw` if it is a safe same-origin relative path, else `null`. */
export function sanitizeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.length > MAX_LENGTH) return null;
  if (!SAFE_RELATIVE_PATH.test(raw)) return null;
  if (HAS_CONTROL_CHARS.test(raw)) return null;
  return raw;
}
