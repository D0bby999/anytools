/**
 * Encrypt/decrypt a short text with a password, entirely with the browser's WebCrypto.
 *
 * Key derivation: PBKDF2-HMAC-SHA256, 310,000 iterations — the OWASP 2023 minimum for that
 * combination. A fresh 16-byte salt and 12-byte IV are drawn for every encryption, so the
 * same plaintext + password never produces the same output twice. Output is Base64 of
 * `salt || iv || ciphertext`: self-describing, but a format only this tool understands —
 * it is not openssl- or 7-zip-compatible, and the FAQ says so.
 */
import { ToolError } from '../shared/tool-error';

export const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AES_KEY_LENGTH = 256;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function assertSecureContext(): void {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new ToolError(
      'noSecureContext',
      'Web Crypto is unavailable in this context. Open this page over HTTPS (or localhost) — browsers only expose crypto.subtle in a secure context.',
    );
  }
}

function assertPassword(password: string): void {
  if (!password) {
    throw new ToolError('emptyPassword', 'Enter a password first.');
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Derive a non-extractable AES-GCM key from a password + salt. Never cached: a fresh salt
 * means a fresh derivation every time, by design. */
async function deriveAesKey(
  password: string,
  salt: Uint8Array,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    usages,
  );
}

export async function encryptText(plaintext: string, password: string): Promise<string> {
  assertSecureContext();
  assertPassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveAesKey(password, salt, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      encoder.encode(plaintext),
    ),
  );
  const payload = new Uint8Array(salt.length + iv.length + ciphertext.length);
  payload.set(salt, 0);
  payload.set(iv, salt.length);
  payload.set(ciphertext, salt.length + iv.length);
  return toBase64(payload);
}

export async function decryptText(payloadBase64: string, password: string): Promise<string> {
  assertSecureContext();
  assertPassword(password);

  let payload: Uint8Array;
  try {
    payload = fromBase64(payloadBase64.trim());
  } catch {
    throw new ToolError(
      'invalidPayload',
      'This is not valid Base64 output from this tool — check you copied the whole string.',
    );
  }
  if (payload.length <= SALT_BYTES + IV_BYTES) {
    throw new ToolError(
      'invalidPayload',
      'This is not valid Base64 output from this tool — check you copied the whole string.',
    );
  }

  const salt = payload.slice(0, SALT_BYTES);
  const iv = payload.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const ciphertext = payload.slice(SALT_BYTES + IV_BYTES);
  const key = await deriveAesKey(password, salt, ['decrypt']);

  try {
    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    );
    return decoder.decode(plainBuffer);
  } catch {
    // GCM's authentication tag failed to verify. That happens for a wrong password just as
    // much as for tampered or truncated ciphertext — WebCrypto does not distinguish the two,
    // and neither should the message pretend to.
    throw new ToolError(
      'wrongPassword',
      'Wrong password, or the encrypted text was altered: the built-in authenticity check failed.',
    );
  }
}
