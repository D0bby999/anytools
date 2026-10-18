/**
 * Generate an RSA or Ed25519 key pair with WebCrypto, exported as PEM.
 *
 * RSA covers both signing (RSASSA-PKCS1-v1_5) and encryption (RSA-OAEP) — the algorithm choice
 * changes only the `generateKey` params and the key usages, never the export path: both key
 * types export as SPKI (public) / PKCS8 (private) DER, wrapped into standard PEM here since
 * WebCrypto has no PEM output of its own. Ed25519 is offered only where the browser's
 * WebCrypto actually supports it — see `isEd25519Supported`.
 */
import { ToolError } from '../shared/tool-error';

export type RsaKeySize = 2048 | 3072 | 4096;
export type RsaAlgorithm = 'RSASSA-PKCS1-v1_5' | 'RSA-OAEP';
export type KeyAlgorithmChoice = RsaAlgorithm | 'Ed25519';

export type KeyPairPem = {
  publicKeyPem: string;
  privateKeyPem: string;
};

const PEM_LINE_LENGTH = 64;
const RSA_PUBLIC_EXPONENT = new Uint8Array([0x01, 0x00, 0x01]); // 65537

function assertSecureContext(): void {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new ToolError(
      'noSecureContext',
      'Web Crypto is unavailable in this context. Open this page over HTTPS (or localhost) — browsers only expose crypto.subtle in a secure context.',
    );
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Base64-wrap DER bytes into PEM: 64-char lines and the matching header/footer. */
function toPem(label: 'PUBLIC KEY' | 'PRIVATE KEY', der: ArrayBuffer): string {
  const base64 = arrayBufferToBase64(der);
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += PEM_LINE_LENGTH) {
    lines.push(base64.slice(i, i + PEM_LINE_LENGTH));
  }
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

async function exportPair(pair: CryptoKeyPair): Promise<KeyPairPem> {
  const [spki, pkcs8] = await Promise.all([
    crypto.subtle.exportKey('spki', pair.publicKey),
    crypto.subtle.exportKey('pkcs8', pair.privateKey),
  ]);
  return { publicKeyPem: toPem('PUBLIC KEY', spki), privateKeyPem: toPem('PRIVATE KEY', pkcs8) };
}

function wrapKeyGenError(error: unknown): never {
  const detail = error instanceof Error ? error.message : String(error);
  throw new ToolError('keyGenFailed', `Key generation failed: ${detail}`, { detail });
}

export async function generateRsaKeyPair(
  algorithm: RsaAlgorithm,
  modulusLength: RsaKeySize,
): Promise<KeyPairPem> {
  assertSecureContext();
  const usages: KeyUsage[] = algorithm === 'RSA-OAEP' ? ['encrypt', 'decrypt'] : ['sign', 'verify'];
  try {
    const pair = (await crypto.subtle.generateKey(
      { name: algorithm, modulusLength, publicExponent: RSA_PUBLIC_EXPONENT, hash: 'SHA-256' },
      true,
      usages,
    )) as CryptoKeyPair;
    return await exportPair(pair);
  } catch (error) {
    wrapKeyGenError(error);
  }
}

export async function generateEd25519KeyPair(): Promise<KeyPairPem> {
  assertSecureContext();
  try {
    const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    return await exportPair(pair);
  } catch (error) {
    wrapKeyGenError(error);
  }
}

let ed25519Support: boolean | null = null;

/**
 * Feature-detect Ed25519 by attempting a real (cheap) key generation. There is no capability
 * flag to read instead: some browsers accept the algorithm name in code review but throw
 * NotSupportedError only once `generateKey` actually runs. Cached after the first call so the
 * UI can check it once on mount without regenerating a throwaway key on every render.
 */
export async function isEd25519Supported(): Promise<boolean> {
  if (ed25519Support !== null) return ed25519Support;
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    ed25519Support = false;
    return false;
  }
  try {
    await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    ed25519Support = true;
  } catch {
    ed25519Support = false;
  }
  return ed25519Support;
}
