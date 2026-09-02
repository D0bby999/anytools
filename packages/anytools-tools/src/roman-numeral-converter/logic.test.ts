import { describe, expect, it } from 'vitest';
import { MAX_ROMAN, RomanError, fromRoman, toRoman } from './logic';

describe('toRoman', () => {
  it('uses subtractive notation, not repetition', () => {
    expect(toRoman(4)).toBe('IV');
    expect(toRoman(9)).toBe('IX');
    expect(toRoman(40)).toBe('XL');
    expect(toRoman(90)).toBe('XC');
    expect(toRoman(400)).toBe('CD');
    expect(toRoman(900)).toBe('CM');
  });

  it('handles the boundaries', () => {
    expect(toRoman(1)).toBe('I');
    expect(toRoman(MAX_ROMAN)).toBe('MMMCMXCIX');
  });

  it('handles common years', () => {
    expect(toRoman(1994)).toBe('MCMXCIV');
    expect(toRoman(2026)).toBe('MMXXVI');
  });

  it('rejects out-of-range and non-integers', () => {
    expect(() => toRoman(0)).toThrow(RomanError);
    expect(() => toRoman(4000)).toThrow(/no symbol above M/);
    expect(() => toRoman(-5)).toThrow(RomanError);
    expect(() => toRoman(1.5)).toThrow(/whole numbers/);
  });
});

describe('fromRoman', () => {
  it('reads subtractive pairs', () => {
    expect(fromRoman('IV')).toBe(4);
    expect(fromRoman('MCMXCIV')).toBe(1994);
  });

  it('is case-insensitive and ignores surrounding space', () => {
    expect(fromRoman('  mcmxciv  ')).toBe(1994);
  });

  it('rejects non-standard forms even though their arithmetic works out', () => {
    // IIII sums to 4 and IM sums to 999; both are readable and neither is valid notation.
    // The round-trip check catches them all without a separate rule per case.
    expect(() => fromRoman('IIII')).toThrow(/not valid standard notation/);
    expect(() => fromRoman('IM')).toThrow(RomanError);
    expect(() => fromRoman('VX')).toThrow(RomanError);
    expect(() => fromRoman('XXXX')).toThrow(RomanError);
  });

  it('suggests the correct form when the value is recoverable', () => {
    expect(() => fromRoman('IIII')).toThrow(/Did you mean IV \(4\)/);
  });

  it('rejects unknown symbols and empty input', () => {
    expect(() => fromRoman('ABC')).toThrow(/"A" is not a Roman numeral symbol/);
    expect(() => fromRoman('')).toThrow(/Enter a Roman numeral/);
  });

  it('round-trips the whole valid range', () => {
    for (let n = 1; n <= MAX_ROMAN; n++) expect(fromRoman(toRoman(n))).toBe(n);
  });
});
