/**
 * HMAC generator + verifier with WebCrypto.
 *
 * Sibling of `hash-generator`'s HMAC tab, but with two things that tab does not have: a key
 * that can be entered as raw text OR hex (needed to match webhook providers that hand out a
 * hex-encoded secret), and a "verify" mode that compares against WebCrypto's own `verify`
 * rather than `===` on the encoded strings — see the comment on `verifyHmac` for why that
 * matters.
 */
import { ToolError } from '../shared/tool-error';

export type HmacAlgo = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
export type KeyEncoding = 'text' | 'hex';
export type OutputEncoding = 'hex' | 'base64';

export type HmacResult = { hex: string; base64: string };

const encoder = new TextEncoder();

function assertSecureContext(): void {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new ToolError(
      'noSecureContext',
      'Web Crypto is unavailable in this context. Open this page over HTTPS (or localhost) — browsers only expose crypto.subtle in a secure context.',
    );
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string, code: string, message: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new ToolError(code, message);
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(base64: string, code: string, message: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(base64.trim());
  } catch {
    throw new ToolError(code, message);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeKey(key: string, keyEncoding: KeyEncoding): Uint8Array {
  if (keyEncoding === 'hex') {
    return hexToBytes(
      key,
      'invalidKeyHex',
      'The key is not valid hex — use only 0-9/a-f, an even number of digits.',
    );
  }
  return encoder.encode(key);
}

function decodeExpected(expected: string, encoding: OutputEncoding): Uint8Array {
  const code = 'invalidExpectedHash';
  const message =
    encoding === 'hex'
      ? 'The expected HMAC is not valid hex — use only 0-9/a-f, an even number of digits.'
      : 'The expected HMAC is not valid Base64.';
  return encoding === 'hex'
    ? hexToBytes(expected, code, message)
    : base64ToBytes(expected, code, message);
}

async function importHmacKey(
  keyBytes: Uint8Array,
  algo: HmacAlgo,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'HMAC', hash: algo },
    false,
    usages,
  );
}

export async function computeHmac(
  message: string,
  key: string,
  keyEncoding: KeyEncoding,
  algo: HmacAlgo,
): Promise<HmacResult> {
  assertSecureContext();
  const keyBytes = encodeKey(key, keyEncoding);
  const cryptoKey = await importHmacKey(keyBytes, algo, ['sign']);
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)),
  );
  return { hex: bytesToHex(signature), base64: bytesToBase64(signature) };
}

/**
 * Compare an expected HMAC against the freshly computed one using WebCrypto's own `verify`,
 * which compares digest bytes in constant time. Comparing two hex/base64 strings with `===`
 * short-circuits at the first mismatched character — an attacker able to measure response
 * timing could exploit that to guess a valid signature one byte at a time. `verify` recomputes
 * the HMAC internally and never has that leak.
 */
export async function verifyHmac(
  message: string,
  key: string,
  keyEncoding: KeyEncoding,
  algo: HmacAlgo,
  expected: string,
  expectedEncoding: OutputEncoding,
): Promise<boolean> {
  assertSecureContext();
  const keyBytes = encodeKey(key, keyEncoding);
  const expectedBytes = decodeExpected(expected, expectedEncoding);
  const cryptoKey = await importHmacKey(keyBytes, algo, ['verify']);
  return crypto.subtle.verify(
    'HMAC',
    cryptoKey,
    expectedBytes as BufferSource,
    encoder.encode(message),
  );
}
