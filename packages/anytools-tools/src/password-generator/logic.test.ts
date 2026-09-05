import { describe, expect, it } from 'vitest';
import { calculateStrength, formatCrackTime, generatePassword } from './logic';

describe('generatePassword', () => {
  it('produces requested length', () => {
    const p = generatePassword({
      length: 24,
      lowercase: true,
      uppercase: true,
      numbers: true,
      symbols: true,
      excludeAmbiguous: false,
    });
    expect(p.length).toBe(24);
  });

  it('uses only the enabled charset', () => {
    const p = generatePassword({
      length: 50,
      lowercase: false,
      uppercase: true,
      numbers: false,
      symbols: false,
      excludeAmbiguous: false,
    });
    expect(p).toMatch(/^[A-Z]+$/);
  });

  it('excludes ambiguous when requested', () => {
    const p = generatePassword({
      length: 200,
      lowercase: true,
      uppercase: true,
      numbers: true,
      symbols: false,
      excludeAmbiguous: true,
    });
    expect(p).not.toMatch(/[0O1lIo]/);
  });

  it('throws when no charset enabled', () => {
    expect(() =>
      generatePassword({
        length: 10,
        lowercase: false,
        uppercase: false,
        numbers: false,
        symbols: false,
        excludeAmbiguous: false,
      }),
    ).toThrow(/character set/);
  });

  it('the no-charset error carries a code for localization', () => {
    expect(() =>
      generatePassword({
        length: 10,
        lowercase: false,
        uppercase: false,
        numbers: false,
        symbols: false,
        excludeAmbiguous: false,
      }),
    ).toThrow(expect.objectContaining({ code: 'noCharset' }));
  });

  // Review 2026-09-05: half of all 8-char passwords lacked a digit or a symbol.
  it('includes at least one character from every enabled set', () => {
    for (let i = 0; i < 300; i++) {
      const p = generatePassword({
        length: 8,
        lowercase: true,
        uppercase: true,
        numbers: true,
        symbols: true,
        excludeAmbiguous: true,
      });
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[0-9]/);
      expect(p).toMatch(/[^A-Za-z0-9]/);
      expect(p).not.toMatch(/[0O1lIo|`']/);
    }
  });

  it('clamps length to safe bounds', () => {
    const tiny = generatePassword({
      length: 1,
      lowercase: true,
      uppercase: false,
      numbers: false,
      symbols: false,
      excludeAmbiguous: false,
    });
    expect(tiny.length).toBe(4);
  });
});

describe('calculateStrength', () => {
  it('classifies weak short password', () => {
    const s = calculateStrength('abc');
    expect(s.level).toBe('weak');
  });
  it('classifies strong long random', () => {
    const s = calculateStrength('aB3!aB3!aB3!aB3!aB3!');
    expect(['strong', 'excellent']).toContain(s.level);
  });
  it('reports crack time string', () => {
    const s = calculateStrength('aB3!aB3!aB3!');
    expect(typeof s.crackTimeLabel).toBe('string');
    expect(s.crackTimeLabel.length).toBeGreaterThan(0);
  });
  it('reports crack time as structured data that matches the label', () => {
    expect(calculateStrength('abc').crackTime).toEqual({ unit: 'instantly', value: 0 });
    const s = calculateStrength('aB3!aB3!aB3!aB3!aB3!');
    expect(s.crackTime.unit).toBe('bYears');
    expect(formatCrackTime(s.crackTime)).toBe(s.crackTimeLabel);
  });
});
