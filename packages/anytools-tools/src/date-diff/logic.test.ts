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
    // days = 1-31 = -30; borrow from Jan (31 days): -30+31 = 1; months = 1
    const r = dateDiff(new Date('2020-01-31'), new Date('2020-03-01'));
    expect(r.years).toBe(0);
    expect(r.months).toBe(1);
    expect(r.days).toBe(1);
  });
});
