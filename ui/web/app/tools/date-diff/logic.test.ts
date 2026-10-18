import { describe, expect, it } from 'vitest';
import { dateDiff } from './logic';

describe('dateDiff', () => {
  it('returns zeros for same date', () => {
    const d = new Date('2024-06-01');
    const r = dateDiff(d, d);
    expect(r.years).toBe(0);
    expect(r.totalDays).toBe(0);
    expect(r.totalHours).toBe(0);
  });

  it('is commutative — order does not matter', () => {
    const a = new Date('2020-01-01');
    const b = new Date('2024-06-15');
    const r1 = dateDiff(a, b);
    const r2 = dateDiff(b, a);
    expect(r1).toEqual(r2);
  });

  it('computes exact years+months+days for a clean anniversary', () => {
    const r = dateDiff(new Date('2020-03-15'), new Date('2024-03-15'));
    expect(r.years).toBe(4);
    expect(r.months).toBe(0);
    expect(r.days).toBe(0);
  });

  it('computes totalWeeks correctly', () => {
    // 14 days = 2 weeks exactly
    const r = dateDiff(new Date('2024-01-01'), new Date('2024-01-15'));
    expect(r.totalDays).toBe(14);
    expect(r.totalWeeks).toBe(2);
  });

  it('handles month-end carry (Jan 31 → Mar 1 in leap year)', () => {
    // 31 Jan + 1 month = 29 Feb (clamped), then one day to 1 Mar
    const r = dateDiff(new Date(2020, 0, 31), new Date(2020, 2, 1));
    expect(r.years).toBe(0);
    expect(r.months).toBe(1);
    expect(r.days).toBe(1);
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

describe('dateDiff calendar arithmetic', () => {
  it.each(CROSS_CHECK)('%s → %s', (start, end, [years, months, days]) => {
    const r = dateDiff(local(start), local(end));
    expect([r.years, r.months, r.days]).toEqual([years, months, days]);
  });

  it('gives the same calendar parts in either order', () => {
    for (const [a, b] of CROSS_CHECK) {
      const forward = dateDiff(local(a), local(b));
      const backward = dateDiff(local(b), local(a));
      expect([backward.years, backward.months, backward.days]).toEqual([
        forward.years,
        forward.months,
        forward.days,
      ]);
    }
  });

  it('keeps the totals consistent with the calendar parts on a plain interval', () => {
    const r = dateDiff(local('2023-12-15'), local('2024-01-10'));
    expect(r.totalDays).toBe(26);
    expect(r.totalWeeks).toBe(3);
    expect(r.days).toBe(26);
  });
});
