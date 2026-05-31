import { describe, expect, it } from 'vitest';
import { calcNeededScore, toLetterGrade } from './logic';

describe('calcNeededScore', () => {
  it('computes score needed when final weight is 30%', () => {
    // current=85, target=90, weight=30
    // needed = (90 - 85*0.7) / 0.3 = (90 - 59.5) / 0.3 = 101.67
    const { needed, achievable } = calcNeededScore(85, 90, 30);
    expect(needed).toBeCloseTo(101.67, 1);
    expect(achievable).toBe(false);
  });

  it('marks achievable when needed score is within 0–100', () => {
    // current=80, target=85, weight=50
    // needed = (85 - 80*0.5) / 0.5 = (85 - 40) / 0.5 = 90
    const { needed, achievable } = calcNeededScore(80, 85, 50);
    expect(needed).toBeCloseTo(90);
    expect(achievable).toBe(true);
  });

  it('returns achievable=false when needed > 100', () => {
    const { achievable } = calcNeededScore(50, 99, 10);
    expect(achievable).toBe(false);
  });

  it('returns achievable=false when needed < 0 (target already met)', () => {
    // current=95, target=80, weight=50 → needed = (80 - 95*0.5) / 0.5 = (80-47.5)/0.5 = 65
    // Actually that's achievable — use current > target much more heavily
    // current=95, target=70, weight=10 → needed = (70 - 95*0.9) / 0.1 = (70-85.5)/0.1 = -155
    const { needed, achievable } = calcNeededScore(95, 70, 10);
    expect(needed).toBeLessThan(0);
    expect(achievable).toBe(false);
  });

  it('handles zero final weight: achievable only if current >= target', () => {
    expect(calcNeededScore(90, 85, 0).achievable).toBe(true);
    expect(calcNeededScore(80, 85, 0).achievable).toBe(false);
  });
});

describe('toLetterGrade', () => {
  it('A for >= 90', () => expect(toLetterGrade(95)).toBe('A'));
  it('B for 80–89', () => expect(toLetterGrade(85)).toBe('B'));
  it('C for 70–79', () => expect(toLetterGrade(75)).toBe('C'));
  it('D for 60–69', () => expect(toLetterGrade(65)).toBe('D'));
  it('F for < 60', () => expect(toLetterGrade(55)).toBe('F'));
  it('boundary: exactly 90 is A', () => expect(toLetterGrade(90)).toBe('A'));
  it('boundary: exactly 80 is B', () => expect(toLetterGrade(80)).toBe('B'));
});
