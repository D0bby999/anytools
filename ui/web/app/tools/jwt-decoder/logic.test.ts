import { describe, expect, it } from 'vitest';
import { decodeJwt, formatDuration, readExpiry, stripBearer } from './logic';

// {"alg":"HS256","typ":"JWT"}.{"sub":"1234567890","name":"John Doe","iat":1516239022}
const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('decodeJwt', () => {
  it('decodes a sample JWT', () => {
    const out = decodeJwt(SAMPLE);
    expect(out.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(out.payload).toEqual({ sub: '1234567890', name: 'John Doe', iat: 1516239022 });
    expect(out.signature.length).toBeGreaterThan(0);
  });

  it('trims whitespace', () => {
    expect(() => decodeJwt(`   ${SAMPLE}   `)).not.toThrow();
  });

  it('throws on missing segments', () => {
    expect(() => decodeJwt('only.two')).toThrow(/three segments/);
    expect(() => decodeJwt('a.b.c.d')).toThrow(/three segments/);
  });

  it('throws on non-Base64URL chars', () => {
    expect(() => decodeJwt('a!b.c.d')).toThrow(/Base64URL/);
  });

  // Prod 2026-09-05: three shapes of real-world token were rejected as "must be Base64URL".
  it('accepts an unsecured (alg none) token with an empty signature', () => {
    const out = decodeJwt('eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.');
    expect(out.header).toEqual({ alg: 'none' });
    expect(out.unsecured).toBe(true);
    expect(decodeJwt(SAMPLE).unsecured).toBe(false);
  });

  it('drops a pasted "Bearer " scheme prefix', () => {
    expect(decodeJwt(`Bearer ${SAMPLE}`).payload).toEqual(decodeJwt(SAMPLE).payload);
    expect(stripBearer('bearer   x.y.z')).toBe('x.y.z');
  });

  it('accepts segments that kept their = padding', () => {
    expect(decodeJwt('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0=.abc').payload).toEqual({ sub: '1' });
  });

  it('throws on invalid JSON payload', () => {
    // Base64URL of "not-json"
    const badPayload = 'bm90LWpzb24';
    expect(() => decodeJwt(`${badPayload}.${badPayload}.sig`)).toThrow(/not valid JSON/);
  });
});

describe('formatDuration', () => {
  it('shows the two largest units', () => {
    expect(formatDuration(31_536_000)).toBe('1y');
    expect(formatDuration(90_061)).toBe('1d 1h');
    expect(formatDuration(3_725)).toBe('1h 2m');
    expect(formatDuration(-45)).toBe('45s');
    expect(formatDuration(0)).toBe('0s');
  });
});

describe('readExpiry', () => {
  it('detects exp in future', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const status = readExpiry({ exp: future });
    expect(status.isExpired).toBe(false);
    expect(status.expiresInSec).toBeGreaterThan(3500);
  });

  it('detects exp in past', () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const status = readExpiry({ exp: past });
    expect(status.isExpired).toBe(true);
    expect(status.expiresInSec).toBeLessThan(0);
  });

  it('handles missing exp', () => {
    const status = readExpiry({ sub: '123' });
    expect(status.exp).toBeNull();
    expect(status.isExpired).toBe(false);
  });
});
