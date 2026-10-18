import * as OTPAuth from 'otpauth';

/**
 * TOTP (RFC 6238) code generation via otpauth (MIT) — fully client-side,
 * secrets never leave the device.
 */

export type TotpOptions = {
  digits: 6 | 8;
  period: 30 | 60;
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
};

export const DEFAULT_OPTIONS: TotpOptions = { digits: 6, period: 30, algorithm: 'SHA1' };

/** Uppercase, strip spaces/dashes. Returns null unless valid non-empty base32. */
export function normalizeSecret(input: string): string | null {
  const cleaned = input.replace(/[\s-]/g, '').toUpperCase().replace(/=+$/, '');
  if (cleaned.length === 0 || !/^[A-Z2-7]+$/.test(cleaned)) return null;
  return cleaned;
}

/** Random 160-bit base32 secret (the size Google Authenticator uses). */
export function generateRandomSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return new OTPAuth.Secret({ buffer: bytes.buffer }).base32;
}

export type TotpCode = {
  code: string;
  remainingSeconds: number;
  period: number;
};

export function currentCode(
  secret: string,
  options: TotpOptions = DEFAULT_OPTIONS,
  timestampMs: number = Date.now(),
): TotpCode | null {
  const normalized = normalizeSecret(secret);
  if (!normalized) return null;
  try {
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(normalized),
      digits: options.digits,
      period: options.period,
      algorithm: options.algorithm,
    });
    const code = totp.generate({ timestamp: timestampMs });
    const elapsed = Math.floor(timestampMs / 1000) % options.period;
    return { code, remainingSeconds: options.period - elapsed, period: options.period };
  } catch {
    return null;
  }
}

export function otpauthUri(
  secret: string,
  label: string,
  issuer: string,
  options: TotpOptions = DEFAULT_OPTIONS,
): string | null {
  const normalized = normalizeSecret(secret);
  if (!normalized) return null;
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(normalized),
    label: label || 'user@example.com',
    issuer: issuer || undefined,
    digits: options.digits,
    period: options.period,
    algorithm: options.algorithm,
  });
  return totp.toString();
}
