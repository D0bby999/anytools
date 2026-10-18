import { describe, expect, it } from 'vitest';
import { decodeHex, encodeHex } from './logic';

describe('encodeHex', () => {
  it('encodes ASCII', () => {
    expect(encodeHex('Hi', { separator: '' })).toBe('4869');
  });
  it('encodes with default space separator', () => {
    expect(encodeHex('Hi')).toBe('48 69');
  });
  it('encodes UTF-8 emoji', () => {
    expect(encodeHex('🌏', { separator: '' })).toBe('f09f8c8f');
  });
  it('encodes Vietnamese', () => {
    expect(encodeHex('cà', { separator: '' })).toBe('63c3a0');
  });
  it('uppercase + prefix', () => {
    expect(encodeHex('Hi', { separator: ' ', prefix: '0x', uppercase: true })).toBe('0x48 0x69');
  });
  it('empty input returns empty', () => {
    expect(encodeHex('')).toBe('');
  });
});

describe('decodeHex', () => {
  it('decodes plain hex', () => {
    expect(decodeHex('4869')).toBe('Hi');
  });
  it('strips spaces and decodes', () => {
    expect(decodeHex('48 69 21')).toBe('Hi!');
  });
  it('strips 0x prefix', () => {
    expect(decodeHex('0x480x69')).toBe('Hi');
  });
  it('case insensitive', () => {
    expect(decodeHex('48 69 F0 9F 8C 8F')).toBe('Hi🌏');
  });
  it('odd length throws', () => {
    expect(() => decodeHex('abc')).toThrow();
  });
  it('accepts common byte separators', () => {
    expect(decodeHex('48:69')).toBe('Hi');
    expect(decodeHex('48,69')).toBe('Hi');
    expect(decodeHex('48-69')).toBe('Hi');
  });
  it('rejects characters that are not hex instead of silently dropping them', () => {
    expect(() => decodeHex('xyz')).toThrow(/not a hex digit/);
    expect(() => decodeHex('48 6g')).toThrow(/"g"/);
  });
  it('empty input returns empty', () => {
    expect(decodeHex('')).toBe('');
  });
});
