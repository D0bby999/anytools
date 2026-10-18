/**
 * Sign and verify JWTs with `jose` (WebCrypto-backed, ESM-only — imported dynamically so the
 * ~15 KB module never lands in the tools bundle for people who never open this tool).
 *
 * This exists because `jwt-decoder` (kept as-is) only *reads* a token — it never checks the
 * signature, so a forged or expired token looks exactly like a valid one there. That is a real
 * gap: someone debugging "why does the API reject my token" needs to know whether the
 * signature is wrong, the token expired, or both are fine and the bug is elsewhere. This tool
 * answers that by actually calling `jwtVerify` and reporting three distinct outcomes instead of
 * a single "decoded" state.
 *
 * `alg: "none"` is rejected by construction, not by a special case: `options.algorithms` is
 * always set to the one algorithm the caller selected, so jose's own allow-list check
 * (`JOSEAlgNotAllowed`) rejects a token whose header claims a different alg — "none" included —
 * before any key material is even touched. This also blocks the classic HS/RS "alg confusion"
 * attack (verifying an RS256-signed token with the public key as if it were an HS256 secret).
 */
import { ToolError } from '../shared/tool-error';

export type SignAlgorithm = 'HS256' | 'HS384' | 'HS512' | 'RS256' | 'ES256';
export const SIGN_ALGORITHMS: SignAlgorithm[] = ['HS256', 'HS384', 'HS512', 'RS256', 'ES256'];
const isHmac = (alg: SignAlgorithm) => alg.startsWith('HS');

export type SignInput = {
  algorithm: SignAlgorithm;
  /** Raw JSON text for the claims set, e.g. `{"sub":"123"}`. */
  payloadJson: string;
  /** UTF-8 secret for HS*, PEM PKCS#8 private key for RS256/ES256. */
  secretOrPrivateKey: string;
  /** jose duration syntax ("1h", "7d") or empty to omit "exp" entirely. */
  expiresIn: string;
};

function parsePayload(json: string): Record<string, unknown> {
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new ToolError('invalidPayloadJson', 'Payload must be valid JSON.');
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ToolError('invalidPayloadJson', 'Payload must be a JSON object, e.g. {"sub":"123"}.');
  }
  return payload as Record<string, unknown>;
}

export async function signJwt(input: SignInput): Promise<string> {
  const { SignJWT, importPKCS8 } = await import('jose');
  const payload = parsePayload(input.payloadJson);

  let key: Uint8Array | CryptoKey;
  if (isHmac(input.algorithm)) {
    if (!input.secretOrPrivateKey.trim()) {
      throw new ToolError('missingSecret', 'Enter a secret to sign with HS256/384/512.');
    }
    key = new TextEncoder().encode(input.secretOrPrivateKey);
  } else {
    try {
      key = await importPKCS8(input.secretOrPrivateKey, input.algorithm);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new ToolError(
        'invalidPrivateKey',
        `Could not read the private key: ${detail}. Expected a PEM PKCS#8 key ("-----BEGIN PRIVATE KEY-----"), matching the selected algorithm's key type.`,
        { detail },
      );
    }
  }

  let signer = new SignJWT(payload)
    .setProtectedHeader({ alg: input.algorithm, typ: 'JWT' })
    .setIssuedAt();
  if (input.expiresIn.trim()) signer = signer.setExpirationTime(input.expiresIn.trim());

  try {
    return await signer.sign(key);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ToolError('signFailed', `Signing failed: ${detail}`, { detail });
  }
}

export type VerifyStatus =
  | 'valid'
  | 'invalidSignature'
  | 'expired'
  | 'notYetValid'
  | 'algRejected'
  | 'malformed';

export type VerifyInput = {
  token: string;
  algorithm: SignAlgorithm;
  /** UTF-8 secret for HS*, PEM SPKI public key for RS256/ES256. */
  secretOrPublicKey: string;
};

export type VerifyResult = {
  status: VerifyStatus;
  header?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  /** English detail, shown as-is (widget maps `status` to its own headline; this is the subtext). */
  detail: string;
};

export async function verifyJwt(input: VerifyInput): Promise<VerifyResult> {
  const { jwtVerify, importSPKI, decodeProtectedHeader, errors } = await import('jose');

  let header: Record<string, unknown> | undefined;
  try {
    header = decodeProtectedHeader(input.token) as Record<string, unknown>;
  } catch {
    // Left undefined — jwtVerify below throws its own descriptive error for a malformed token.
  }

  let key: Uint8Array | CryptoKey;
  if (isHmac(input.algorithm)) {
    if (!input.secretOrPublicKey.trim()) {
      throw new ToolError('missingSecret', 'Enter the secret this token was signed with.');
    }
    key = new TextEncoder().encode(input.secretOrPublicKey);
  } else {
    try {
      key = await importSPKI(input.secretOrPublicKey, input.algorithm);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new ToolError(
        'invalidPublicKey',
        `Could not read the public key: ${detail}. Expected a PEM SPKI key ("-----BEGIN PUBLIC KEY-----"), matching the selected algorithm's key type.`,
        { detail },
      );
    }
  }

  try {
    const { payload } = await jwtVerify(input.token, key, { algorithms: [input.algorithm] });
    return {
      status: 'valid',
      header,
      payload: payload as Record<string, unknown>,
      detail: 'Signature valid, and every timestamp claim (exp/nbf) checks out.',
    };
  } catch (e) {
    if (e instanceof errors.JWTExpired) {
      return {
        status: 'expired',
        header,
        payload: e.payload as Record<string, unknown>,
        detail: 'Signature is valid, but the "exp" claim is in the past — this token has expired.',
      };
    }
    if (e instanceof errors.JWTClaimValidationFailed && e.claim === 'nbf') {
      return {
        status: 'notYetValid',
        header,
        payload: e.payload as Record<string, unknown>,
        detail: 'Signature is valid, but the "nbf" claim is in the future — not valid yet.',
      };
    }
    if (e instanceof errors.JWSSignatureVerificationFailed) {
      return {
        status: 'invalidSignature',
        header,
        detail:
          'Signature does not match this key — wrong secret/key, or the token was tampered with.',
      };
    }
    if (e instanceof errors.JOSEAlgNotAllowed || e instanceof errors.JOSENotSupported) {
      const declared = typeof header?.alg === 'string' ? header.alg : 'unknown';
      return {
        status: 'algRejected',
        header,
        detail: `Rejected: the token declares "${declared}", not the selected "${input.algorithm}". Never trust the "alg" header — this includes blocking "alg: none".`,
      };
    }
    const detail = e instanceof Error ? e.message : String(e);
    return { status: 'malformed', header, detail: `Could not verify: ${detail}` };
  }
}
