/**
 * URL encoding utilities (RFC 3986).
 * Wraps the browser native functions with friendly error messages
 * + query-string helpers that the standard library doesn't expose.
 */

export function encodeUrlComponent(input: string): string {
  return encodeURIComponent(input);
}

export function encodeUrl(input: string): string {
  return encodeURI(input);
}

export type DecodeOptions = {
  /**
   * Treat `+` as a space, as application/x-www-form-urlencoded does. Query strings copied
   * from a browser use this; a `+` in a path segment is literal. decodeURIComponent alone
   * never converts it, which is why "hello+world" used to come back unchanged.
   */
  plusAsSpace?: boolean;
};

export function decodeUrlComponent(input: string, options: DecodeOptions = {}): string {
  const source = options.plusAsSpace ? input.replace(/\+/g, ' ') : input;
  try {
    return decodeURIComponent(source);
  } catch {
    throw new Error('Invalid URL-encoded input (malformed % escape)');
  }
}

export function buildQueryString(params: Record<string, string | number | boolean>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join('&');
}

export function parseQueryString(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  const cleaned = qs.startsWith('?') ? qs.slice(1) : qs;
  if (cleaned.length === 0) return out;
  for (const pair of cleaned.split('&')) {
    const [rawKey, rawVal = ''] = pair.split('=');
    if (!rawKey) continue;
    try {
      out[decodeURIComponent(rawKey)] = decodeURIComponent(rawVal.replace(/\+/g, ' '));
    } catch {
      throw new Error(`Invalid query string segment: ${pair}`);
    }
  }
  return out;
}
