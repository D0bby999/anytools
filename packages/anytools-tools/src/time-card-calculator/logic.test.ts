import { describe, expect, it } from 'vitest';
import { parseHM, dayHours, summariseWeek } from './logic';

describe('parseHM', () => {
  it('returns null for empty string', () => {
    expect(parseHM('')).toBeNull();
  });

  it('parses 09:00 as 540', () => {
    expect(parseHM('09:00')).toBe(540);
  });

  it('parses 17:30 as 1050', () => {
    expect(parseHM('17:30')).toBe(1050);
  });

  it('parses 00:00 as 0', () => {
    expect(parseHM('00:00')).toBe(0);
  });
});

describe('dayHours', () => {
  it('returns 0 when in or out is empty', () => {
    expect(dayHours({ label: 'Mon', in: '', out: '17:00', break: 0 })).toBe(0);
    expect(dayHours({ label: 'Mon', in: '09:00', out: '', break: 0 })).toBe(0);
  });

  it('computes standard 8-hour day minus 30 min break', () => {
    const h = dayHours({ label: 'Mon', in: '09:00', out: '17:00', break: 30 });
    expect(h).toBeCloseTo(7.5);
  });

  it('handles overnight shift (22:00 → 06:00, no break)', () => {
    const h = dayHours({ label: 'Sat', in: '22:00', out: '06:00', break: 0 });
    expect(h).toBeCloseTo(8);
  });

  it('clamps negative net hours to 0', () => {
    // 30-min shift with 60-min break
    const h = dayHours({ label: 'X', in: '09:00', out: '09:30', break: 60 });
    expect(h).toBe(0);
  });
});

describe('summariseWeek', () => {
  const makeDay = (inTime: string, outTime: string, breakMin = 30) => ({
    label: 'X',
    in: inTime,
    out: outTime,
    break: breakMin,
  });

  it('no overtime for standard 37.5h week', () => {
    // 5 days × 7.5h = 37.5h
    const days = Array.from({ length: 5 }, () => makeDay('09:00', '17:00', 30));
    const r = summariseWeek(days, 20);
    expect(r.totalHours).toBeCloseTo(37.5);
    expect(r.overtimeHours).toBe(0);
    expect(r.grossPay).toBeCloseTo(37.5 * 20);
  });

  it('computes overtime for hours > 40', () => {
    // 5 days × 9h (no break) = 45h → 5h OT
    const days = Array.from({ length: 5 }, () => makeDay('09:00', '18:00', 0));
    const r = summariseWeek(days, 20);
    expect(r.totalHours).toBeCloseTo(45);
    expect(r.regularHours).toBeCloseTo(40);
    expect(r.overtimeHours).toBeCloseTo(5);
    expect(r.grossPay).toBeCloseTo(40 * 20 + 5 * 20 * 1.5);
  });

  it('empty days array returns all zeros', () => {
    const r = summariseWeek([], 20);
    expect(r.totalHours).toBe(0);
    expect(r.grossPay).toBe(0);
  });
});
