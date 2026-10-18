import { describe, expect, it } from 'vitest';
import { KM_PER_MILE, calculatePace, formatPace, formatTime, toKm } from './logic';

describe('calculatePace', () => {
  it('calculates pace for 10km in 50min', () => {
    const { paceSecPerKm } = calculatePace(10, 50 * 60);
    // 3000s / 10km = 300s/km = 5:00/km
    expect(paceSecPerKm).toBeCloseTo(300);
  });

  it('paceSecPerMile = paceSecPerKm × KM_PER_MILE', () => {
    const { paceSecPerKm, paceSecPerMile } = calculatePace(10, 3000);
    expect(paceSecPerMile).toBeCloseTo(paceSecPerKm * KM_PER_MILE);
  });

  it('returns 0 for zero distance', () => {
    const { paceSecPerKm } = calculatePace(0, 3000);
    expect(paceSecPerKm).toBe(0);
  });
});

describe('toKm', () => {
  it('passes km through unchanged', () => {
    expect(toKm(10, 'km')).toBe(10);
  });

  it('converts miles to km', () => {
    expect(toKm(1, 'mile')).toBeCloseTo(KM_PER_MILE);
  });
});

describe('formatPace', () => {
  it('formats 300s as 5:00', () => {
    expect(formatPace(300)).toBe('5:00');
  });

  it('formats 375s as 6:15', () => {
    expect(formatPace(375)).toBe('6:15');
  });

  it('returns — for 0 or negative', () => {
    expect(formatPace(0)).toBe('—');
    expect(formatPace(-1)).toBe('—');
  });
});

describe('formatTime', () => {
  it('formats sub-hour time as Xm YYs', () => {
    expect(formatTime(50 * 60)).toBe('50m 00s');
  });

  it('formats time with hours', () => {
    expect(formatTime(3 * 3600 + 15 * 60 + 30)).toBe('3h 15m 30s');
  });

  it('returns — for 0 or non-finite', () => {
    expect(formatTime(0)).toBe('—');
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
