import { Base64 } from 'js-base64';

/**
 * Encode a UTF-8 string to standard Base64 (RFC 4648).
 * UTF-8 safe — handles unicode, emoji, RTL text correctly (unlike native btoa).
 */
export function encodeBase64(input: string): string {
  return Base64.encode(input);
}

/**
 * Decode standard Base64 back to UTF-8 string.
 * Throws if input is not valid Base64.
 */
export function decodeBase64(input: string): string {
  if (!isValidBase64(input)) {
    throw new Error('Invalid Base64 input');
  }
  return Base64.decode(input);
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
  if (!isValidBase64Url(input)) {
    throw new Error('Invalid Base64URL input');
  }
  return Base64.decode(input);
}

const STANDARD_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const URL_RE = /^[A-Za-z0-9\-_]*={0,2}$/;

export function isValidBase64(input: string): boolean {
  if (input.length === 0) return true;
  if (input.length % 4 !== 0) return false;
  return STANDARD_RE.test(input);
}

export function isValidBase64Url(input: string): boolean {
  if (input.length === 0) return true;
  return URL_RE.test(input);
}
