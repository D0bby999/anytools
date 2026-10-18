import { describe, expect, it } from 'vitest';
import {
  BaseConvertError,
  convertToCommonBases,
  formatInBase,
  normalizeInput,
  parseInBase,
} from './logic';

describe('parseInBase', () => {
  it('reads the common bases', () => {
    expect(parseInBase('255', 10)).toBe(255n);
    expect(parseInBase('ff', 16)).toBe(255n);
    expect(parseInBase('11111111', 2)).toBe(255n);
    expect(parseInBase('377', 8)).toBe(255n);
  });

  it('is exact above 2^53, where parseInt is not', () => {
    // parseInt('9007199254740993') returns 9007199254740992. For a converter that is a
    // wrong answer presented as a right one, which is why this uses BigInt.
    expect(parseInBase('9007199254740993', 10)).toBe(9007199254740993n);
    expect(formatInBase(parseInBase('9007199254740993', 10), 16)).toBe('20000000000001');
  });

  it('accepts pasted prefixes and underscore separators', () => {
    expect(parseInBase('0xFF', 16)).toBe(255n);
    expect(parseInBase('0b1010', 2)).toBe(10n);
    expect(parseInBase('0o17', 8)).toBe(15n);
    expect(parseInBase('1_000_000', 10)).toBe(1000000n);
  });

  it('handles negatives and case', () => {
    expect(parseInBase('-FF', 16)).toBe(-255n);
    expect(parseInBase('DeadBeef', 16)).toBe(3735928559n);
  });

  it('rejects a digit that does not exist in the base', () => {
    expect(() => parseInBase('2', 2)).toThrow(BaseConvertError);
    expect(() => parseInBase('19', 8)).toThrow(/"9" is not a valid digit in base 8/);
    expect(() => parseInBase('g', 16)).toThrow(BaseConvertError);
  });

  it('rejects empty input and out-of-range bases', () => {
    expect(() => parseInBase('', 10)).toThrow(/Enter a number/);
    expect(() => parseInBase('  ', 10)).toThrow(BaseConvertError);
    expect(() => parseInBase('1', 1)).toThrow(/between 2 and 36/);
    expect(() => parseInBase('1', 37)).toThrow(/between 2 and 36/);
  });

  it('supports the full 2-36 range', () => {
    expect(parseInBase('z', 36)).toBe(35n);
    expect(formatInBase(35n, 36)).toBe('z');
  });

  it('round-trips through every base', () => {
    for (let b = 2; b <= 36; b++) {
      expect(parseInBase(formatInBase(123456789n, b), b)).toBe(123456789n);
    }
  });

  it('handles zero', () => {
    expect(parseInBase('0', 10)).toBe(0n);
    expect(formatInBase(0n, 2)).toBe('0');
  });
});

describe('normalizeInput', () => {
  it('only strips a prefix that matches the base', () => {
    // "0b1010" read as hex is a real hex number (0xb1010), not a prefixed binary one.
    expect(normalizeInput('0b1010', 16)).toBe('0b1010');
    expect(normalizeInput('0b1010', 2)).toBe('1010');
  });
});

describe('convertToCommonBases', () => {
  it('returns binary, octal, decimal and hex', () => {
    expect(convertToCommonBases('255', 10).map((r) => r.value)).toEqual([
      '11111111',
      '377',
      '255',
      'ff',
    ]);
  });
});
