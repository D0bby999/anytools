import { Base64 } from 'js-base64';

/**
 * Encode a UTF-8 string to standard Base64 (RFC 4648).
 * UTF-8 safe — handles unicode, emoji, RTL text correctly (unlike native btoa).
 */
export function encodeBase64(input: string): string {
  return Base64.encode(input);
}

/**
 * Copy-pasted Base64 rarely arrives clean: MIME wraps it at 76 columns, terminals append
 * a newline, and JWT/OAuth-style producers drop the `=` padding. None of that changes the
 * bytes, so whitespace is stripped and padding restored before validation. Only a
 * remainder of 1 (e.g. 5 chars) can never be valid Base64.
 */
export function normalizeBase64(input: string): string {
  const compact = input.replace(/\s+/g, '').replace(/=+$/, '');
  const rem = compact.length % 4;
  return rem === 0 ? compact : compact + '='.repeat(4 - rem);
}

/**
 * Decode standard Base64 back to UTF-8 string.
 * Throws if input is not valid Base64.
 */
export function decodeBase64(input: string): string {
  const normalized = normalizeBase64(input);
  if (!isValidBase64(normalized)) {
    throw new Error('Invalid Base64 input');
  }
  return Base64.decode(normalized);
}

/**
 * Encode to URL-safe Base64 (RFC 4648 §5).
 * Replaces `+/` with `-_` and strips padding `=`.
 * Used in JWT, OAuth, data URIs in URLs.
 */
export function encodeBase64Url(input: string): string {
  return Base64.encodeURI(input);
}

/**
 * Decode URL-safe Base64 back to UTF-8 string.
 * Accepts both `-_` (URL-safe) and `+/` (standard) alphabets.
 */
export function decodeBase64Url(input: string): string {
  const compact = input.replace(/\s+/g, '');
  if (!isValidBase64Url(compact)) {
    throw new Error('Invalid Base64URL input');
  }
  return Base64.decode(compact);
}

const STANDARD_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const URL_RE = /^[A-Za-z0-9\-_]*={0,2}$/;

export function isValidBase64(input: string): boolean {
  const normalized = normalizeBase64(input);
  if (normalized.length === 0) return true;
  // A single leftover char can't encode anything; three '=' means rem was 1.
  if (normalized.endsWith('===')) return false;
  return STANDARD_RE.test(normalized);
}

export function isValidBase64Url(input: string): boolean {
  if (input.length === 0) return true;
  return URL_RE.test(input);
}
