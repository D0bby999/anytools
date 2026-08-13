import { createHmac, timingSafeEqual } from 'node:crypto';

// timingSafeEqual throws RangeError on length mismatch — a wrong-length token or
// signature must produce a clean `false` (→ 401), never an uncaught 500: the
// contract treats 5xx as retryable, so a 500 here would turn a bad credential
// into an indefinite retry loop instead of a "reconnect channel" prompt.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function verifyBearer(authorizationHeader: string | null, expectedToken: string): boolean {
  if (!authorizationHeader || expectedToken.length === 0) return false;
  const token = authorizationHeader.replace(/^Bearer\s+/i, '');
  return token.length > 0 && safeEqual(token, expectedToken);
}

/**
 * Verify `X-PostClaw-Signature: sha256=<hex>` over the raw request body with the
 * bearer token as HMAC key. The signature is REQUIRED on mutating requests:
 * PostClaw always signs POST/PATCH for a connected account, so an unsigned
 * request is either tampered (header stripped in transit) or not from PostClaw.
 * Treating it as optional would let an attacker bypass the check by omission.
 */
export function verifySignature(
  signatureHeader: string | null,
  rawBody: string,
  token: string,
): boolean {
  if (!signatureHeader) return false;
  const computed = `sha256=${createHmac('sha256', token).update(rawBody, 'utf8').digest('hex')}`;
  return safeEqual(computed, signatureHeader);
}
