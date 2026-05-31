import { describe, expect, it } from 'vitest';
import { decodeBinary, encodeBinary } from './logic';

describe('encodeBinary', () => {
  it('encodes A = 01000001', () => {
    expect(encodeBinary('A')).toBe('01000001');
  });
  it('encodes Hi with default separator', () => {
    expect(encodeBinary('Hi')).toBe('01001000 01101001');
  });
  it('custom separator', () => {
    expect(encodeBinary('Hi', '')).toBe('0100100001101001');
  });
  it('UTF-8 multi-byte', () => {
    expect(encodeBinary('é', '')).toBe('1100001110101001');
  });
  it('empty input returns empty', () => {
    expect(encodeBinary('')).toBe('');
  });
});

describe('decodeBinary', () => {
  it('decodes ASCII', () => {
    expect(decodeBinary('01001000 01101001')).toBe('Hi');
  });
  it('strips non-01 characters', () => {
    expect(decodeBinary('01001000-01101001')).toBe('Hi');
  });
  it('decodes UTF-8 multi-byte', () => {
    expect(decodeBinary('1100001110101001')).toBe('é');
  });
  it('non-multiple-of-8 throws', () => {
    expect(() => decodeBinary('0100100')).toThrow();
  });
  it('empty input returns empty', () => {
    expect(decodeBinary('')).toBe('');
  });
});
