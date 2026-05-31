import { describe, expect, it } from 'vitest';
import { hashText, hmac } from './logic';

describe('hashText', () => {
  it('empty string SHA-256 matches known value', async () => {
    expect(await hashText('', 'sha-256')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
  it('hello MD5 matches', async () => {
    expect(await hashText('hello', 'md5')).toBe('5d41402abc4b2a76b9719d911017c592');
  });
  it('hello SHA-1', async () => {
    expect(await hashText('hello', 'sha-1')).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
  });
  it('hello SHA-512 starts correctly', async () => {
    const hex = await hashText('hello', 'sha-512');
    expect(hex.length).toBe(128);
    expect(hex.startsWith('9b71d224bd62f3785d96d46ad3ea3d73')).toBe(true);
  });
  it('emits base64 encoding when requested', async () => {
    const b64 = await hashText('hello', 'sha-256', 'base64');
    expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
  it('UTF-8 input hashed correctly', async () => {
    const h = await hashText('世界', 'sha-256');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hmac', () => {
  it('HMAC-SHA-256 with known key/message', async () => {
    // RFC 4231 test vector #1
    const sig = await hmac('key', 'The quick brown fox jumps over the lazy dog', 'sha-256');
    expect(sig).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  });
});
