import { describe, expect, it } from 'vitest';
import { currentCode, generateRandomSecret, normalizeSecret, otpauthUri } from './logic';

// RFC 6238 Appendix B test secret: ASCII "12345678901234567890" in base32.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('normalizeSecret', () => {
  it('uppercases and strips separators/padding', () => {
    expect(normalizeSecret('gezd gnbv-gy3t')).toBe('GEZDGNBVGY3T');
    expect(normalizeSecret('MFRGG===')).toBe('MFRGG');
  });
  it('rejects non-base32 input', () => {
    expect(normalizeSecret('hello!1')).toBeNull();
    expect(normalizeSecret('')).toBeNull();
    expect(normalizeSecret('018')).toBeNull(); // 0,1,8 are not base32 chars
  });
});

describe('currentCode', () => {
  it('matches the RFC 6238 SHA1 test vector at t=59s (8 digits)', () => {
    const result = currentCode(
      RFC_SECRET,
      { digits: 8, period: 30, algorithm: 'SHA1' },
      59 * 1000,
    );
    expect(result?.code).toBe('94287082');
    expect(result?.remainingSeconds).toBe(1);
  });

  it('matches the RFC vector at t=1111111109s', () => {
    const result = currentCode(
      RFC_SECRET,
      { digits: 8, period: 30, algorithm: 'SHA1' },
      1111111109 * 1000,
    );
    expect(result?.code).toBe('07081804');
  });

  it('returns 6-digit codes by default', () => {
    const result = currentCode(RFC_SECRET, undefined, 59 * 1000);
    expect(result?.code).toHaveLength(6);
  });

  it('returns null for an invalid secret', () => {
    expect(currentCode('not base32!!')).toBeNull();
  });
});

describe('generateRandomSecret', () => {
  it('produces a 32-char base32 string (160 bits)', () => {
    const secret = generateRandomSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateRandomSecret()).not.toBe(secret);
  });
});

describe('otpauthUri', () => {
  it('builds a scannable otpauth:// URI', () => {
    const uri = otpauthUri(RFC_SECRET, 'me@anytools.world', 'AnyTools');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('issuer=AnyTools');
    expect(uri).toContain(`secret=${RFC_SECRET}`);
  });
  it('returns null for an invalid secret', () => {
    expect(otpauthUri('!!', 'a', 'b')).toBeNull();
  });
});
