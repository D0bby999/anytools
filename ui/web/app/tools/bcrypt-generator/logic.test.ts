import { describe, expect, it } from 'vitest';
import { clampRounds, hashPassword, parseCostFactor, verifyPassword } from './logic';

describe('hashPassword / verifyPassword', () => {
  it('roundtrips a password (low rounds for test speed)', async () => {
    const hash = await hashPassword('s3cret!', 4);
    expect(hash).toMatch(/^\$2[abxy]\$04\$/);
    await expect(verifyPassword('s3cret!', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong', hash)).resolves.toBe(false);
  });

  it('produces different hashes for the same input (random salt)', async () => {
    const [a, b] = await Promise.all([hashPassword('same', 4), hashPassword('same', 4)]);
    expect(a).not.toBe(b);
  });

  it('verifyPassword returns false on malformed hash instead of throwing', async () => {
    await expect(verifyPassword('x', 'not-a-bcrypt-hash')).resolves.toBe(false);
  });
});

describe('clampRounds', () => {
  it('clamps into the supported range', () => {
    expect(clampRounds(1)).toBe(4);
    expect(clampRounds(99)).toBe(15);
    expect(clampRounds(10.6)).toBe(11);
    expect(clampRounds(Number.NaN)).toBe(10);
  });
});

describe('parseCostFactor', () => {
  it('reads the cost from a hash', async () => {
    const hash = await hashPassword('x', 5);
    expect(parseCostFactor(hash)).toBe(5);
  });
  it('returns null for garbage', () => {
    expect(parseCostFactor('hello')).toBeNull();
  });
});
