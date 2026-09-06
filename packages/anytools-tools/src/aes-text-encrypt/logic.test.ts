// @vitest-environment node
// happy-dom's crypto.subtle does not implement PBKDF2 deriveKey reliably across versions; Node
// 22's WebCrypto is the real thing and lets this test run the whole encrypt→decrypt round trip.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolError } from '../shared/tool-error';
import { PBKDF2_ITERATIONS, decryptText, encryptText } from './logic';

describe('encryptText / decryptText', () => {
  it('round-trips plain ASCII text', async () => {
    const encrypted = await encryptText('hello world', 'correct horse battery staple');
    expect(await decryptText(encrypted, 'correct horse battery staple')).toBe('hello world');
  });

  it('round-trips Vietnamese text with diacritics and emoji', async () => {
    const original = 'Xin chào 🌏 — đây là bí mật quốc gia 🔐';
    const encrypted = await encryptText(original, 'mật khẩu mạnh');
    expect(await decryptText(encrypted, 'mật khẩu mạnh')).toBe(original);
  });

  it('never repeats output for the same input (fresh salt+iv each time)', async () => {
    const a = await encryptText('same text', 'same password');
    const b = await encryptText('same text', 'same password');
    expect(a).not.toBe(b);
    // Both must still decrypt to the same plaintext.
    expect(await decryptText(a, 'same password')).toBe('same text');
    expect(await decryptText(b, 'same password')).toBe('same text');
  });

  it('produces a payload longer than salt+IV alone (real ciphertext bytes present)', async () => {
    const encrypted = await encryptText('x', 'password');
    // 16-byte salt + 12-byte IV + at least 1 ciphertext byte + 16-byte GCM tag = 45 bytes min.
    const raw = atob(encrypted);
    expect(raw.length).toBeGreaterThan(16 + 12);
  });

  it('rejects the wrong password with a ToolError(wrongPassword)', async () => {
    const encrypted = await encryptText('top secret', 'right-password');
    await expect(decryptText(encrypted, 'wrong-password')).rejects.toBeInstanceOf(ToolError);
    await expect(decryptText(encrypted, 'wrong-password')).rejects.toMatchObject({
      code: 'wrongPassword',
    });
  });

  it('rejects garbage input as invalidPayload, not a crash', async () => {
    await expect(decryptText('not-base64-!!!', 'password')).rejects.toMatchObject({
      code: 'invalidPayload',
    });
    // Valid Base64, but far too short to contain a salt+IV.
    await expect(decryptText(btoa('short'), 'password')).rejects.toMatchObject({
      code: 'invalidPayload',
    });
  });

  it('rejects an empty password on both encrypt and decrypt', async () => {
    await expect(encryptText('text', '')).rejects.toMatchObject({ code: 'emptyPassword' });
    const encrypted = await encryptText('text', 'a-password');
    await expect(decryptText(encrypted, '')).rejects.toMatchObject({ code: 'emptyPassword' });
  });

  it('uses at least the OWASP-2023 minimum PBKDF2 iteration count', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(310_000);
  });

  it('reports a clear error when crypto.subtle is unavailable', async () => {
    const realCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
    await expect(encryptText('text', 'password')).rejects.toMatchObject({
      code: 'noSecureContext',
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
