/**
 * Parse X.509 certificates (PEM or DER) with `@peculiar/x509` — imported dynamically, and only
 * for its exported classes; the ASN.1 walk itself is entirely the library's, per the phase
 * brief ("đừng tự viết parser ASN.1"). See `./reflect-metadata-stub.ts` for why importing that
 * library needs a small polyfill first.
 */
import { ToolError } from '../shared/tool-error';
import { ensureReflectMetadataStub } from './reflect-metadata-stub';

export type X509SanEntry = { type: string; value: string };
export type X509PublicKeyInfo = { algorithm: string; keySize?: number; curve?: string };
export type X509BasicConstraints = { isCa: boolean; pathLengthConstraint?: number };

/** Stable ids for the nine RFC 5280 KeyUsage bits — the widget translates them, this stays English. */
export type KeyUsageId =
  | 'digitalSignature'
  | 'nonRepudiation'
  | 'keyEncipherment'
  | 'dataEncipherment'
  | 'keyAgreement'
  | 'keyCertSign'
  | 'cRLSign'
  | 'encipherOnly'
  | 'decipherOnly';

const KEY_USAGE_BITS: [KeyUsageId, number][] = [
  ['digitalSignature', 1],
  ['nonRepudiation', 2],
  ['keyEncipherment', 4],
  ['dataEncipherment', 8],
  ['keyAgreement', 16],
  ['keyCertSign', 32],
  ['cRLSign', 64],
  ['encipherOnly', 128],
  ['decipherOnly', 256],
];

/** Known Extended Key Usage OIDs (RFC 5280 §4.2.1.12) mapped to a stable id; unknown OIDs pass
 * through as-is so the widget can still display them. */
const EKU_OID_IDS: Record<string, string> = {
  '1.3.6.1.5.5.7.3.1': 'serverAuth',
  '1.3.6.1.5.5.7.3.2': 'clientAuth',
  '1.3.6.1.5.5.7.3.3': 'codeSigning',
  '1.3.6.1.5.5.7.3.4': 'emailProtection',
  '1.3.6.1.5.5.7.3.8': 'timeStamping',
  '1.3.6.1.5.5.7.3.9': 'ocspSigning',
};

export type X509ParsedCert = {
  subject: string;
  issuer: string;
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
  signatureAlgorithm: string;
  publicKey: X509PublicKeyInfo;
  san: X509SanEntry[];
  keyUsageIds: KeyUsageId[];
  /** Stable id from EKU_OID_IDS, or the raw OID for one this table does not know. */
  extendedKeyUsageIds: string[];
  basicConstraints: X509BasicConstraints | null;
  fingerprintSha1: string;
  fingerprintSha256: string;
  isSelfSigned: boolean;
  isExpired: boolean;
  isNotYetValid: boolean;
  /** Negative once expired. Relative to the moment this certificate was parsed. */
  daysRemaining: number;
};

/** Uppercase, colon-separated hex — the conventional display for a serial number or fingerprint. */
function toHexColon(bytes: ArrayBuffer | string): string {
  const hex =
    typeof bytes === 'string' ? bytes : Array.from(new Uint8Array(bytes), byteToHex).join('');
  return (hex.match(/.{1,2}/g) ?? []).map((b) => b.toUpperCase()).join(':');
}
const byteToHex = (b: number) => b.toString(16).padStart(2, '0');

function decodeKeyUsage(usages: number): KeyUsageId[] {
  return KEY_USAGE_BITS.filter(([, bit]) => (usages & bit) !== 0).map(([id]) => id);
}

function describePublicKey(algorithm: Algorithm): X509PublicKeyInfo {
  const a = algorithm as Algorithm & { modulusLength?: number; namedCurve?: string };
  if (typeof a.modulusLength === 'number') return { algorithm: 'RSA', keySize: a.modulusLength };
  if (typeof a.namedCurve === 'string')
    return { algorithm: 'EC', keySize: undefined, curve: a.namedCurve };
  return { algorithm: a.name };
}

function describeSignatureAlgorithm(algorithm: { name: string; hash?: { name: string } }): string {
  return algorithm.hash ? `${algorithm.hash.name} with ${algorithm.name}` : algorithm.name;
}

async function parseOneCertificate(raw: string | ArrayBuffer): Promise<X509ParsedCert> {
  ensureReflectMetadataStub();
  const {
    X509Certificate,
    KeyUsagesExtension,
    ExtendedKeyUsageExtension,
    SubjectAlternativeNameExtension,
    BasicConstraintsExtension,
  } = await import('@peculiar/x509');

  let cert: InstanceType<typeof X509Certificate>;
  try {
    cert = new X509Certificate(raw);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ToolError(
      'invalidCertificate',
      `Could not read this as an X.509 certificate: ${detail}`,
      { detail },
    );
  }

  const now = new Date();
  const san = cert.getExtension(SubjectAlternativeNameExtension);
  const keyUsage = cert.getExtension(KeyUsagesExtension);
  const eku = cert.getExtension(ExtendedKeyUsageExtension);
  const bc = cert.getExtension(BasicConstraintsExtension);

  const [sha1, sha256] = await Promise.all([
    cert.getThumbprint('SHA-1'),
    cert.getThumbprint('SHA-256'),
  ]);

  let isSelfSigned: boolean;
  try {
    isSelfSigned = await cert.isSelfSigned();
  } catch {
    // Verification needs an algorithm WebCrypto happens to support; if it doesn't, the string
    // comparison is the same heuristic browsers themselves fall back to for this check.
    isSelfSigned = cert.subject === cert.issuer;
  }

  return {
    subject: cert.subject,
    issuer: cert.issuer,
    serialNumber: toHexColon(cert.serialNumber),
    notBefore: cert.notBefore,
    notAfter: cert.notAfter,
    signatureAlgorithm: describeSignatureAlgorithm(cert.signatureAlgorithm),
    publicKey: describePublicKey(cert.publicKey.algorithm),
    san: san ? san.names.items.map((n) => ({ type: n.type, value: n.value })) : [],
    keyUsageIds: keyUsage ? decodeKeyUsage(keyUsage.usages) : [],
    // `usages` is typed as `ExtendedKeyUsage | string` per the library's own ASN.1 layer, but at
    // runtime every entry is a plain OID string — `String()` here is a type-safe indexing key,
    // not a behavior change.
    extendedKeyUsageIds: eku
      ? eku.usages.map((oid) => EKU_OID_IDS[String(oid)] ?? String(oid))
      : [],
    basicConstraints: bc ? { isCa: bc.ca, pathLengthConstraint: bc.pathLength } : null,
    fingerprintSha1: toHexColon(sha1),
    fingerprintSha256: toHexColon(sha256),
    isSelfSigned,
    isExpired: now.getTime() > cert.notAfter.getTime(),
    isNotYetValid: now.getTime() < cert.notBefore.getTime(),
    daysRemaining: Math.floor((cert.notAfter.getTime() - now.getTime()) / 86_400_000),
  };
}

function splitPemCertificates(text: string): string[] {
  return text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
}

/** Paste box path — text is always PEM; a file with more than one `BEGIN CERTIFICATE` block
 * (a chain) is parsed in file order, per the phase brief. */
export async function parseCertificateText(pemText: string): Promise<X509ParsedCert[]> {
  const blocks = splitPemCertificates(pemText);
  if (blocks.length === 0) {
    throw new ToolError(
      'noCertificateFound',
      'No "-----BEGIN CERTIFICATE-----" block found. Paste a PEM certificate, or use the file upload for a DER-encoded .cer/.crt/.der.',
    );
  }
  return Promise.all(blocks.map(parseOneCertificate));
}

/** File upload path — most `.cer`/`.crt`/`.der` files are binary DER, but some are PEM text
 * saved with one of those extensions, so the bytes are sniffed rather than trusted from the
 * file name. */
export async function parseCertificateFile(file: File): Promise<X509ParsedCert[]> {
  const buffer = await file.arrayBuffer();
  const asText = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  if (asText.includes('-----BEGIN CERTIFICATE-----')) {
    return parseCertificateText(asText);
  }
  return [await parseOneCertificate(buffer)];
}
