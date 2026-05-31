import { describe, expect, it } from 'vitest';
import { classifyBodyFat, usNavyBodyFat } from './logic';

describe('usNavyBodyFat', () => {
  it('returns a plausible male body fat percentage', () => {
    // Standard male: 170cm height, 85cm waist, 38cm neck
    const bf = usNavyBodyFat('male', 170, 85, 38, 0);
    expect(bf).not.toBeNull();
    expect(bf!).toBeGreaterThan(10);
    expect(bf!).toBeLessThan(30);
  });

  it('returns a plausible female body fat percentage', () => {
    // Standard female: 165cm height, 75cm waist, 34cm neck, 95cm hip
    const bf = usNavyBodyFat('female', 165, 75, 34, 95);
    expect(bf).not.toBeNull();
    expect(bf!).toBeGreaterThan(20);
    expect(bf!).toBeLessThan(40);
  });

  it('returns null when waist <= neck for male (invalid log10 domain)', () => {
    expect(usNavyBodyFat('male', 170, 38, 38, 0)).toBeNull();
    expect(usNavyBodyFat('male', 170, 30, 38, 0)).toBeNull();
  });

  it('returns null when waist + hip <= neck for female', () => {
    expect(usNavyBodyFat('female', 165, 10, 50, 10)).toBeNull();
  });

  it('returns null for zero height', () => {
    expect(usNavyBodyFat('male', 0, 85, 38, 0)).toBeNull();
  });
});

describe('classifyBodyFat', () => {
  it('classifies male essential fat below 6%', () => {
    expect(classifyBodyFat(5, 'male')).toMatchObject({ label: 'Essential fat', tone: 'warn' });
  });

  it('classifies male athletic between 6-14%', () => {
    expect(classifyBodyFat(10, 'male')).toMatchObject({ label: 'Athletic', tone: 'good' });
  });

  it('classifies male high above 25%', () => {
    expect(classifyBodyFat(30, 'male')).toMatchObject({ label: 'High', tone: 'warn' });
  });

  it('classifies female average between 25-31%', () => {
    expect(classifyBodyFat(28, 'female')).toMatchObject({ label: 'Average', tone: 'neutral' });
  });

  it('classifies female high at 32% and above', () => {
    expect(classifyBodyFat(35, 'female')).toMatchObject({ label: 'High', tone: 'warn' });
  });
});
