/**
 * Convert an integer between bases 2-36.
 * Implemented from the ECMAScript spec for Number.prototype.toString(radix) and parseInt;
 * no third-party source consulted.
 */

import { ToolError } from '../shared/tool-error';

export class BaseConvertError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'BaseConvertError';
  }
}

export const COMMON_BASES = [2, 8, 10, 16] as const;
export const MIN_BASE = 2;
export const MAX_BASE = 36;

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Strip the prefixes people paste along with the number: 0x, 0b, 0o, and _ separators. */
export function normalizeInput(raw: string, base: number): string {
  let s = raw.trim().toLowerCase().replace(/_/g, '');
  const sign = s.startsWith('-') ? '-' : '';
  if (sign) s = s.slice(1);
  if (base === 16 && s.startsWith('0x')) s = s.slice(2);
  else if (base === 2 && s.startsWith('0b')) s = s.slice(2);
  else if (base === 8 && s.startsWith('0o')) s = s.slice(2);
  return sign + s;
}

/**
 * Parse to a BigInt rather than a Number.
 * parseInt silently loses precision above 2^53 — parseInt('9007199254740993') returns
 * ...992 — which for a tool whose entire job is exactness is the wrong failure.
 */
export function parseInBase(raw: string, base: number): bigint {
  if (base < MIN_BASE || base > MAX_BASE) {
    throw new BaseConvertError('baseRange', `Base must be between ${MIN_BASE} and ${MAX_BASE}.`, {
      min: MIN_BASE,
      max: MAX_BASE,
    });
  }
  const s = normalizeInput(raw, base);
  if (!s || s === '-') throw new BaseConvertError('enterNumber', 'Enter a number.');
  const negative = s.startsWith('-');
  const body = negative ? s.slice(1) : s;

  let value = 0n;
  const big = BigInt(base);
  for (const ch of body) {
    const digit = DIGITS.indexOf(ch);
    if (digit < 0 || digit >= base) {
      throw new BaseConvertError(
        'invalidDigit',
        `"${ch}" is not a valid digit in base ${base}. Allowed: ${DIGITS.slice(0, base)}`,
        { char: ch, base, allowed: DIGITS.slice(0, base) },
      );
    }
    value = value * big + BigInt(digit);
  }
  return negative ? -value : value;
}

export function formatInBase(value: bigint, base: number): string {
  if (base < MIN_BASE || base > MAX_BASE) {
    throw new BaseConvertError('baseRange', `Base must be between ${MIN_BASE} and ${MAX_BASE}.`, {
      min: MIN_BASE,
      max: MAX_BASE,
    });
  }
  return value.toString(base);
}

export type ConversionRow = { base: number; label: string; value: string };

export function convertToCommonBases(raw: string, fromBase: number): ConversionRow[] {
  const value = parseInBase(raw, fromBase);
  const labels: Record<number, string> = { 2: 'Binary', 8: 'Octal', 10: 'Decimal', 16: 'Hex' };
  return COMMON_BASES.map((b) => ({
    base: b,
    label: labels[b] ?? `Base ${b}`,
    value: formatInBase(value, b),
  }));
}
