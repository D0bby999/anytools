import { describe, expect, it } from 'vitest';
import {
  CYCLE_MIN,
  FALL_ASLEEP_MIN,
  computeSleepTimes,
  offsetMinutes,
  parseTimeString,
} from './logic';

describe('offsetMinutes', () => {
  it('adds positive minutes', () => {
    const base = new Date('2024-01-01T22:00:00');
    const result = offsetMinutes(base, 90);
    expect(result.getHours()).toBe(23);
    expect(result.getMinutes()).toBe(30);
  });

  it('subtracts negative minutes (wrap across midnight)', () => {
    const base = new Date('2024-01-02T00:30:00');
    const result = offsetMinutes(base, -90);
    expect(result.getHours()).toBe(23);
    expect(result.getMinutes()).toBe(0);
  });
});

describe('parseTimeString', () => {
  it('parses HH:MM correctly', () => {
    const ref = new Date('2024-06-15T00:00:00');
    const d = parseTimeString('07:30', ref);
    expect(d.getHours()).toBe(7);
    expect(d.getMinutes()).toBe(30);
  });

  it('preserves reference date', () => {
    const ref = new Date('2024-06-15T12:00:00');
    const d = parseTimeString('23:00', ref);
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(5); // June = index 5
  });
});

describe('computeSleepTimes', () => {
  const anchor = new Date('2024-01-01T07:00:00');

  it('returns one row per cycle count', () => {
    const rows = computeSleepTimes('wakeUp', anchor, [6, 5, 4, 3]);
    expect(rows).toHaveLength(4);
  });

  it('marks cycle 5 as emphasis', () => {
    const rows = computeSleepTimes('wakeUp', anchor);
    const emphasis = rows.filter((r) => r.emphasis);
    expect(emphasis).toHaveLength(1);
    expect(emphasis[0]?.label).toMatch(/^5 cycles/);
  });

  it('wakeUp mode: target is before anchor', () => {
    const rows = computeSleepTimes('wakeUp', anchor);
    for (const row of rows) {
      expect(row.target.getTime()).toBeLessThan(anchor.getTime());
    }
  });

  it('goToBed mode: target is after anchor', () => {
    const rows = computeSleepTimes('goToBed', anchor);
    for (const row of rows) {
      expect(row.target.getTime()).toBeGreaterThan(anchor.getTime());
    }
  });

  it('5-cycle wakeUp offset = 5*90 + 14 = 464 minutes before anchor', () => {
    const rows = computeSleepTimes('wakeUp', anchor, [5]);
    const expected = anchor.getTime() - (5 * CYCLE_MIN + FALL_ASLEEP_MIN) * 60_000;
    expect(rows[0]?.target.getTime()).toBe(expected);
  });
});
