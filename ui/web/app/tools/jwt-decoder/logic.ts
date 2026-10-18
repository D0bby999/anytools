import { Base64 } from 'js-base64';
import { ToolError } from '../shared/tool-error';

export type JwtPart = { raw: string; decoded: object | string };
export type DecodedJwt = {
  header: object;
  payload: object;
  signature: string;
  /** RFC 7519 §6: an "unsecured" JWT has `alg: none` and an empty signature part. */
  unsecured: boolean;
  raw: { header: string; payload: string; signature: string };
};

// Base64URL, tolerating the `=` padding some encoders leave on.
const PART_RE = /^[A-Za-z0-9\-_]+={0,2}$/;
const SIGNATURE_RE = /^[A-Za-z0-9\-_]*={0,2}$/;

/**
 * Tokens are usually pasted straight out of an Authorization header or a cookie, so the
 * "Bearer " scheme prefix is dropped rather than reported as a malformed token.
 */
export function stripBearer(token: string): string {
  return token.trim().replace(/^bearer\s+/i, '');
}

export function decodeJwt(token: string): DecodedJwt {
  const trimmed = stripBearer(token);
  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    throw new ToolError(
      'jwtSegments',
      'Invalid JWT format — expected three segments separated by `.`',
    );
  }
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];
  if (!PART_RE.test(rawHeader) || !PART_RE.test(rawPayload) || !SIGNATURE_RE.test(rawSignature)) {
    throw new ToolError('jwtNotBase64Url', 'Invalid JWT — segments must be Base64URL');
  }
  return {
    header: parseSegment(rawHeader, 'header'),
    payload: parseSegment(rawPayload, 'payload'),
    signature: rawSignature,
    unsecured: rawSignature.length === 0,
    raw: { header: rawHeader, payload: rawPayload, signature: rawSignature },
  };
}

/**
 * "31536000s" tells nobody anything; "365d" does. Largest two units only, so a token that
 * expires in 400 days reads "1y 35d", not "1y 35d 4h 12m 9s".
 */
export function formatDuration(totalSeconds: number): string {
  const abs = Math.abs(Math.floor(totalSeconds));
  const units: [string, number][] = [
    ['y', 31_536_000],
    ['d', 86_400],
    ['h', 3_600],
    ['m', 60],
    ['s', 1],
  ];
  const parts: string[] = [];
  let rest = abs;
  for (const [label, size] of units) {
    if (rest >= size) {
      parts.push(`${Math.floor(rest / size)}${label}`);
      rest %= size;
    }
    if (parts.length === 2) break;
  }
  return parts.length ? parts.join(' ') : '0s';
}

function parseSegment(raw: string, label: string): object {
  let decoded: string;
  try {
    decoded = Base64.decode(raw);
  } catch {
    throw new ToolError('jwtSegmentDecode', `Invalid JWT ${label} — failed Base64URL decode`, {
      label,
    });
  }
  try {
    return JSON.parse(decoded);
  } catch {
    throw new ToolError('jwtSegmentJson', `Invalid JWT ${label} — not valid JSON`, { label });
  }
}

export type ExpiryStatus = {
  exp: Date | null;
  iat: Date | null;
  nbf: Date | null;
  isExpired: boolean;
  expiresInSec: number | null;
};

export function readExpiry(payload: object): ExpiryStatus {
  const p = payload as Record<string, unknown>;
  const exp = typeof p.exp === 'number' ? new Date(p.exp * 1000) : null;
  const iat = typeof p.iat === 'number' ? new Date(p.iat * 1000) : null;
  const nbf = typeof p.nbf === 'number' ? new Date(p.nbf * 1000) : null;
  const now = Date.now();
  return {
    exp,
    iat,
    nbf,
    isExpired: exp ? exp.getTime() < now : false,
    expiresInSec: exp ? Math.floor((exp.getTime() - now) / 1000) : null,
  };
}
