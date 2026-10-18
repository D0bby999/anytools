// @vitest-environment node
// RSA/Ed25519 key generation and PEM export need a real WebCrypto implementation; happy-dom's
// crypto.subtle does not implement generateKey for these algorithms. Node 22 does.
import { describe, expect, it } from 'vitest';
import { generateEd25519KeyPair, generateRsaKeyPair, isEd25519Supported } from './logic';

/** Parse the DER bytes back out of a PEM block, undoing exactly what `toPem` did. */
function pemToDer(pem: string): ArrayBuffer {
  const base64 = pem
    .split('\n')
    .filter((line) => line && !line.startsWith('-----'))
    .join('');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

describe('generateRsaKeyPair', () => {
  it('produces a 2048-bit signing key pair that WebCrypto can re-import', async () => {
    const { publicKeyPem, privateKeyPem } = await generateRsaKeyPair('RSASSA-PKCS1-v1_5', 2048);
    expect(publicKeyPem).toMatch(/^-----BEGIN PUBLIC KEY-----\n/);
    expect(publicKeyPem).toMatch(/-----END PUBLIC KEY-----\n$/);
    expect(privateKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);

    const publicKey = await crypto.subtle.importKey(
      'spki',
      pemToDer(publicKeyPem),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      true,
      ['verify'],
    );
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      pemToDer(privateKeyPem),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      true,
      ['sign'],
    );

    // The imported pair actually works together — the strongest proof the PEM round-trips.
    const message = new TextEncoder().encode('anytools rsa-keypair-generator');
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, message);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, message);
    expect(valid).toBe(true);
  });

  it('wraps PEM lines at 64 characters, matching RFC 1421/PEM convention', async () => {
    const { publicKeyPem } = await generateRsaKeyPair('RSASSA-PKCS1-v1_5', 2048);
    const bodyLines = publicKeyPem.trim().split('\n').slice(1, -1);
    for (const line of bodyLines.slice(0, -1)) {
      expect(line.length).toBe(64);
    }
  });

  it('produces an RSA-OAEP key pair usable for encrypt/decrypt', async () => {
    const { publicKeyPem, privateKeyPem } = await generateRsaKeyPair('RSA-OAEP', 2048);
    const publicKey = await crypto.subtle.importKey(
      'spki',
      pemToDer(publicKeyPem),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['encrypt'],
    );
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      pemToDer(privateKeyPem),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['decrypt'],
    );
    const message = new TextEncoder().encode('secret payload');
    const ciphertext = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, message);
    const plain = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, ciphertext);
    expect(new TextDecoder().decode(plain)).toBe('secret payload');
  });

  it('produces different key sizes with proportionally larger DER output', async () => {
    const small = await generateRsaKeyPair('RSASSA-PKCS1-v1_5', 2048);
    const large = await generateRsaKeyPair('RSASSA-PKCS1-v1_5', 4096);
    expect(large.privateKeyPem.length).toBeGreaterThan(small.privateKeyPem.length);
  });
});

describe('generateEd25519KeyPair', () => {
  it('produces a key pair that WebCrypto can re-import and use', async () => {
    const supported = await isEd25519Supported();
    expect(supported).toBe(true); // Node 22's WebCrypto implements Ed25519.

    const { publicKeyPem, privateKeyPem } = await generateEd25519KeyPair();
    const publicKey = await crypto.subtle.importKey(
      'spki',
      pemToDer(publicKeyPem),
      'Ed25519',
      true,
      ['verify'],
    );
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      pemToDer(privateKeyPem),
      'Ed25519',
      true,
      ['sign'],
    );
    const message = new TextEncoder().encode('anytools ed25519');
    const signature = await crypto.subtle.sign('Ed25519', privateKey, message);
    const valid = await crypto.subtle.verify('Ed25519', publicKey, signature, message);
    expect(valid).toBe(true);
  });
});

describe('isEd25519Supported', () => {
  it('caches its result across calls', async () => {
    const first = await isEd25519Supported();
    const second = await isEd25519Supported();
    expect(first).toBe(second);
  });
});
