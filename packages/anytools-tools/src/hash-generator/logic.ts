import { md5 } from 'js-md5';

export type HashAlgo = 'md5' | 'sha-1' | 'sha-256' | 'sha-384' | 'sha-512';
export type HashEncoding = 'hex' | 'base64';

const ENCODER = new TextEncoder();

export async function hashText(
  text: string,
  algo: HashAlgo,
  encoding: HashEncoding = 'hex',
): Promise<string> {
  if (algo === 'md5') {
    const hex = md5(text);
    return encoding === 'hex' ? hex : hexToBase64(hex);
  }
  const subtleAlgo = subtleName(algo);
  const buffer = await crypto.subtle.digest(subtleAlgo, ENCODER.encode(text));
  return encodeBuffer(buffer, encoding);
}

export async function hashFile(
  file: Blob,
  algo: HashAlgo,
  encoding: HashEncoding = 'hex',
): Promise<string> {
  if (algo === 'md5') {
    const buffer = await file.arrayBuffer();
    const hex = md5(new Uint8Array(buffer));
    return encoding === 'hex' ? hex : hexToBase64(hex);
  }
  const buffer = await crypto.subtle.digest(subtleName(algo), await file.arrayBuffer());
  return encodeBuffer(buffer, encoding);
}

export async function hmac(
  key: string,
  message: string,
  algo: Exclude<HashAlgo, 'md5'>,
  encoding: HashEncoding = 'hex',
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(key),
    { name: 'HMAC', hash: subtleName(algo) },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, ENCODER.encode(message));
  return encodeBuffer(signature, encoding);
}

function subtleName(algo: Exclude<HashAlgo, 'md5'>): string {
  return algo.toUpperCase();
}

function encodeBuffer(buffer: ArrayBuffer, encoding: HashEncoding): string {
  const bytes = new Uint8Array(buffer);
  if (encoding === 'hex') {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function hexToBase64(hex: string): string {
  let binary = '';
  for (let i = 0; i < hex.length; i += 2) {
    binary += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return btoa(binary);
}
