import { describe, expect, it } from 'vitest';
import {
  MAX_PAYLOAD_BYTES,
  base64FromBytes,
  bytesFromBase64,
  bytesFromFile,
  bytesFromHex,
  formatBytes,
  hexFromBytes,
} from './binary-input';

describe('bytesFromHex', () => {
  it('parses plain hex', () => {
    expect(bytesFromHex('deadbeef')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });
  it('accepts 0x prefix and separators', () => {
    expect(bytesFromHex('0xDE AD:BE-EF')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });
  it('throws on empty input', () => {
    expect(() => bytesFromHex('   ')).toThrow(/paste or upload/i);
  });
  it('throws on non-hex character', () => {
    expect(() => bytesFromHex('zz')).toThrow(/is not a hex digit/);
  });
  it('throws on odd length', () => {
    expect(() => bytesFromHex('abc')).toThrow(/odd number/);
  });
  it('throws when decoded payload exceeds the size cap', () => {
    const hugeHex = 'ab'.repeat(MAX_PAYLOAD_BYTES + 1);
    expect(() => bytesFromHex(hugeHex)).toThrow(/above the/);
  });
});

describe('bytesFromBase64', () => {
  it('parses standard Base64 with padding', () => {
    expect(bytesFromBase64('3q2+7w==')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });
  it('parses Base64 without padding', () => {
    expect(bytesFromBase64('3q2+7w')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });
  it('parses URL-safe Base64', () => {
    // bytes [0xff, 0xfb] -> standard "//s=" but URL-safe uses "__s"
    const std = base64FromBytes(new Uint8Array([0xff, 0xfb]));
    const urlSafe = std.replace(/\+/g, '-').replace(/\//g, '_');
    expect(bytesFromBase64(urlSafe)).toEqual(new Uint8Array([0xff, 0xfb]));
  });
  it('throws on empty input', () => {
    expect(() => bytesFromBase64('')).toThrow(/paste or upload/i);
  });
  it('throws on invalid characters', () => {
    expect(() => bytesFromBase64('not base64!!')).toThrow(/not valid Base64/);
  });
  it('throws on a length remainder of 1 (impossible for Base64)', () => {
    expect(() => bytesFromBase64('abcde')).toThrow(/not valid Base64/);
  });
});

describe('bytesFromFile', () => {
  it('wraps an ArrayBuffer', () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    expect(bytesFromFile(buf)).toEqual(new Uint8Array([1, 2, 3]));
  });
  it('throws when the file exceeds the size cap', () => {
    const buf = new ArrayBuffer(MAX_PAYLOAD_BYTES + 1);
    expect(() => bytesFromFile(buf)).toThrow(/above the/);
  });
});

describe('round-trip', () => {
  it('hex -> bytes -> hex preserves data (modulo spacing)', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x7f, 0x80, 0xff]);
    expect(bytesFromHex(hexFromBytes(bytes))).toEqual(bytes);
  });
  it('base64 -> bytes -> base64 preserves data', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x7f, 0x80, 0xff]);
    expect(bytesFromBase64(base64FromBytes(bytes))).toEqual(bytes);
  });
});

describe('formatBytes', () => {
  it('formats bytes, KB and MB', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
