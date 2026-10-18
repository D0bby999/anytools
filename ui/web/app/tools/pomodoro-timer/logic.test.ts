import { describe, expect, it } from 'vitest';
import { DURATIONS, fmtSeconds, phaseProgress } from './logic';

describe('fmtSeconds', () => {
  it('formats zero as 00:00', () => {
    expect(fmtSeconds(0)).toBe('00:00');
  });

  it('formats 25 minutes correctly', () => {
    expect(fmtSeconds(25 * 60)).toBe('25:00');
  });

  it('formats 90 seconds as 01:30', () => {
    expect(fmtSeconds(90)).toBe('01:30');
  });

  it('pads single-digit minutes and seconds', () => {
    expect(fmtSeconds(65)).toBe('01:05');
  });
});

describe('phaseProgress', () => {
  it('returns 0 at start (full remaining)', () => {
    expect(phaseProgress('focus', DURATIONS.focus)).toBe(0);
  });

  it('returns 100 at end (0 remaining)', () => {
    expect(phaseProgress('focus', 0)).toBe(100);
  });

  it('returns ~50 at halfway', () => {
    expect(phaseProgress('short', DURATIONS.short / 2)).toBeCloseTo(50);
  });

  it('works for all three phases', () => {
    expect(phaseProgress('long', 0)).toBe(100);
    expect(phaseProgress('short', DURATIONS.short)).toBe(0);
  });
});

describe('DURATIONS', () => {
  it('focus is 25 minutes', () => {
    expect(DURATIONS.focus).toBe(1500);
  });

  it('short break is 5 minutes', () => {
    expect(DURATIONS.short).toBe(300);
  });

  it('long break is 15 minutes', () => {
    expect(DURATIONS.long).toBe(900);
  });
});
