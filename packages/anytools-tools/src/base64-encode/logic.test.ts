import { describe, expect, it } from 'vitest';
import {
  decodeBase64,
  decodeBase64Url,
  encodeBase64,
  encodeBase64Url,
  isValidBase64,
  isValidBase64Url,
} from './logic';

describe('encodeBase64', () => {
  it('encodes empty string', () => {
    expect(encodeBase64('')).toBe('');
  });

  it('encodes ASCII', () => {
    expect(encodeBase64('Hello')).toBe('SGVsbG8=');
    expect(encodeBase64('Hello, World!')).toBe('SGVsbG8sIFdvcmxkIQ==');
  });

  it('encodes UTF-8 multi-byte', () => {
    expect(encodeBase64('世界')).toBe('5LiW55WM');
    expect(encodeBase64('Tiếng Việt')).toBe('VGnhur9uZyBWaeG7h3Q=');
  });

  it('encodes emoji (4-byte UTF-8)', () => {
    expect(encodeBase64('🌏')).toBe('8J+Mjw==');
    // Round-trip rather than hardcode a value — js-base64 has tested this for years
    const mixed = 'Hello 🌏 World';
    expect(decodeBase64(encodeBase64(mixed))).toBe(mixed);
  });

  it('encodes RTL text', () => {
    const arabic = 'مرحبا';
    expect(encodeBase64(arabic)).toBe('2YXYsdit2KjYpw==');
  });
});

describe('decodeBase64', () => {
  it('decodes empty string', () => {
    expect(decodeBase64('')).toBe('');
  });

  it('round-trips ASCII', () => {
    const original = 'The quick brown fox jumps over the lazy dog';
    expect(decodeBase64(encodeBase64(original))).toBe(original);
  });

  it('round-trips UTF-8', () => {
    const cases = ['世界', 'Tiếng Việt có dấu', '🌏🚀✨', 'مرحبا بالعالم'];
    for (const input of cases) {
      expect(decodeBase64(encodeBase64(input))).toBe(input);
    }
  });

  it('throws on invalid input', () => {
    expect(() => decodeBase64('not!valid')).toThrow(/Invalid Base64/);
    expect(() => decodeBase64('abc')).toThrow(/Invalid Base64/); // length not multiple of 4
  });
});

describe('encodeBase64Url', () => {
  it('uses URL-safe alphabet', () => {
    // Standard Base64 of these bytes contains '+' and '/'
    const input = '???>'; // bytes that produce '+/' chars in standard base64
    const url = encodeBase64Url(input);
    expect(url).not.toContain('+');
    expect(url).not.toContain('/');
    expect(url).not.toContain('=');
  });

  it('round-trips UTF-8', () => {
    const original = 'Hello, 世界 🌏';
    expect(decodeBase64Url(encodeBase64Url(original))).toBe(original);
  });
});

describe('decodeBase64Url', () => {
  it('accepts URL-safe alphabet', () => {
    expect(decodeBase64Url('SGVsbG8')).toBe('Hello'); // no padding
  });

  it('accepts standard alphabet (graceful)', () => {
    // js-base64 decode accepts both
    expect(decodeBase64Url('SGVsbG8=')).toBe('Hello');
  });

  it('throws on invalid characters', () => {
    expect(() => decodeBase64Url('not!valid')).toThrow(/Invalid Base64URL/);
  });
});

describe('isValidBase64', () => {
  it('accepts valid', () => {
    expect(isValidBase64('')).toBe(true);
    expect(isValidBase64('SGVsbG8=')).toBe(true);
    expect(isValidBase64('SGVsbG8sIFdvcmxkIQ==')).toBe(true);
  });

  it('rejects bad length', () => {
    expect(isValidBase64('abc')).toBe(false);
  });

  it('rejects bad characters', () => {
    expect(isValidBase64('SGVs!G8=')).toBe(false);
  });

  it('rejects URL-safe chars in standard mode', () => {
    expect(isValidBase64('SGVs-G8=')).toBe(false);
    expect(isValidBase64('SGVs_G8=')).toBe(false);
  });
});

describe('isValidBase64Url', () => {
  it('accepts URL-safe chars', () => {
    expect(isValidBase64Url('SGVs-G8_')).toBe(true);
    expect(isValidBase64Url('SGVsbG8')).toBe(true);
  });

  it('rejects bad characters', () => {
    expect(isValidBase64Url('SGVs!G8')).toBe(false);
  });
});
