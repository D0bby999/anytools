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
    // 31 Jan + 1 month = 29 Feb (clamped), then one day to 1 Mar
    const birth = new Date(2000, 0, 31);
    const ref = new Date(2000, 2, 1);
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

// Review 2026-09-05: the month-borrow loop read the length of the wrong month, so 4 of these
// 9 cases were wrong (30 Apr → 1 May came out as two days). Expected values are what a person
// counts, and what date-fns' intervalToDuration returns.
const CROSS_CHECK: [string, string, [number, number, number]][] = [
  ['2024-04-30', '2024-05-01', [0, 0, 1]],
  ['2024-01-31', '2024-03-01', [0, 1, 1]],
  ['2024-01-31', '2024-03-10', [0, 1, 10]],
  ['2024-05-31', '2024-07-01', [0, 1, 1]],
  ['2023-12-15', '2024-01-10', [0, 0, 26]],
  ['2024-02-29', '2025-03-01', [1, 0, 1]],
  ['2000-08-31', '2024-10-05', [24, 1, 5]],
  ['2024-03-31', '2024-05-30', [0, 1, 30]],
  ['2024-01-15', '2024-03-14', [0, 1, 28]],
];
const local = (iso: string) => new Date(`${iso}T00:00:00`);

describe('calcAge calendar arithmetic', () => {
  it.each(CROSS_CHECK)('%s → %s', (birth, ref, [years, months, days]) => {
    const r = calcAge(local(birth), local(ref));
    expect([r?.years, r?.months, r?.days]).toEqual([years, months, days]);
  });

  it('a baby born yesterday is one day old, not two', () => {
    const r = calcAge(local('2024-04-30'), local('2024-05-01'));
    expect(r?.days).toBe(1);
    expect(r?.totalDays).toBe(1);
  });

  it('a leap-day birthday turns one on 1 March of the next year', () => {
    const r = calcAge(local('2024-02-29'), local('2025-03-01'));
    expect([r?.years, r?.months, r?.days]).toEqual([1, 0, 1]);
  });
});
