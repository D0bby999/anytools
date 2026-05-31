import { Base64 } from 'js-base64';

export type JwtPart = { raw: string; decoded: object | string };
export type DecodedJwt = {
  header: object;
  payload: object;
  signature: string;
  raw: { header: string; payload: string; signature: string };
};

const PART_RE = /^[A-Za-z0-9\-_]+$/;

export function decodeJwt(token: string): DecodedJwt {
  const trimmed = token.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format — expected three segments separated by `.`');
  }
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];
  if (!PART_RE.test(rawHeader) || !PART_RE.test(rawPayload) || !PART_RE.test(rawSignature)) {
    throw new Error('Invalid JWT — segments must be Base64URL');
  }
  return {
    header: parseSegment(rawHeader, 'header'),
    payload: parseSegment(rawPayload, 'payload'),
    signature: rawSignature,
    raw: { header: rawHeader, payload: rawPayload, signature: rawSignature },
  };
}

function parseSegment(raw: string, label: string): object {
  let decoded: string;
  try {
    decoded = Base64.decode(raw);
  } catch {
    throw new Error(`Invalid JWT ${label} — failed Base64URL decode`);
  }
  try {
    return JSON.parse(decoded);
  } catch {
    throw new Error(`Invalid JWT ${label} — not valid JSON`);
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
