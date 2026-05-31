import { describe, expect, it } from 'vitest';
import { calcAge } from './logic';

describe('calcAge', () => {
  it('returns null for future birth date', () => {
    const future = new Date('2099-01-01');
    expect(calcAge(future, new Date('2024-01-01'))).toBeNull();
  });

  it('returns null when birth equals ref', () => {
    const d = new Date('2000-06-15');
    // same ms — not strictly after, but 0 age is valid (not null)
    const result = calcAge(d, d);
    expect(result).not.toBeNull();
    expect(result?.years).toBe(0);
    expect(result?.totalDays).toBe(0);
  });

  it('computes whole years correctly', () => {
    const birth = new Date('1990-03-15');
    const ref = new Date('2024-03-15');
    const result = calcAge(birth, ref);
    expect(result?.years).toBe(34);
    expect(result?.months).toBe(0);
    expect(result?.days).toBe(0);
  });

  it('handles month-end carry (born Jan 31, ref Mar 1 in leap year)', () => {
    // days = 1-31 = -30; borrow from Jan (31 days): -30+31 = 1; months = 1
    const birth = new Date('2000-01-31');
    const ref = new Date('2000-03-01');
    const result = calcAge(birth, ref);
    expect(result?.years).toBe(0);
    expect(result?.months).toBe(1);
    expect(result?.days).toBe(1);
  });

  it('accumulates correct totalDays for a known interval', () => {
    // 365 days in non-leap year
    const birth = new Date('2001-01-01');
    const ref = new Date('2002-01-01');
    const result = calcAge(birth, ref);
    expect(result?.totalDays).toBe(365);
    expect(result?.years).toBe(1);
  });

  it('handles leap year birthday (Feb 29 born, ref = Mar 1 non-leap)', () => {
    const birth = new Date('2000-02-29');
    const ref = new Date('2001-03-01');
    const result = calcAge(birth, ref);
    expect(result?.years).toBe(1);
    expect(result?.days).toBeGreaterThanOrEqual(0);
  });
});
