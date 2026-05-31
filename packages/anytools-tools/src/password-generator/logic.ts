const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?';
const AMBIGUOUS = new Set(['0', 'O', 'o', '1', 'l', 'I', '|', '`', "'"]);

export type PasswordOptions = {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
};

export function generatePassword(options: PasswordOptions): string {
  const pool = buildPool(options);
  if (pool.length === 0) throw new Error('At least one character set must be enabled');
  const length = Math.max(4, Math.min(options.length, 256));
  // Generate length unbiased values via crypto.getRandomValues
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += pool[bytes[i]! % pool.length];
  }
  return result;
}

function buildPool(options: PasswordOptions): string {
  let pool = '';
  if (options.lowercase) pool += LOWER;
  if (options.uppercase) pool += UPPER;
  if (options.numbers) pool += DIGITS;
  if (options.symbols) pool += SYMBOLS;
  if (options.excludeAmbiguous) {
    pool = Array.from(pool)
      .filter((c) => !AMBIGUOUS.has(c))
      .join('');
  }
  return pool;
}

export type StrengthLevel = 'weak' | 'fair' | 'strong' | 'excellent';
export type Strength = {
  bits: number;
  level: StrengthLevel;
  crackTimeLabel: string;
};

export function calculateStrength(password: string): Strength {
  const poolSize = uniquePoolSize(password);
  const bits = password.length * Math.log2(poolSize || 1);
  let level: StrengthLevel = 'weak';
  if (bits >= 100) level = 'excellent';
  else if (bits >= 75) level = 'strong';
  else if (bits >= 50) level = 'fair';
  return { bits, level, crackTimeLabel: estimateCrackTime(bits) };
}

function uniquePoolSize(password: string): number {
  let hasLower = false;
  let hasUpper = false;
  let hasDigit = false;
  let hasSymbol = false;
  for (const ch of password) {
    if (LOWER.includes(ch)) hasLower = true;
    else if (UPPER.includes(ch)) hasUpper = true;
    else if (DIGITS.includes(ch)) hasDigit = true;
    else hasSymbol = true;
  }
  return (hasLower ? 26 : 0) + (hasUpper ? 26 : 0) + (hasDigit ? 10 : 0) + (hasSymbol ? 32 : 0);
}

function estimateCrackTime(bits: number): string {
  // Assume offline attack at 10^10 guesses/sec (high-end GPU farm)
  const guessesPerSec = 1e10;
  const totalGuesses = 2 ** bits;
  const seconds = totalGuesses / guessesPerSec;
  if (seconds < 60) return 'instantly';
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} hours`;
  if (seconds < 31_536_000) return `${Math.round(seconds / 86_400)} days`;
  const years = seconds / 31_536_000;
  if (years < 1e3) return `${Math.round(years)} years`;
  if (years < 1e6) return `${Math.round(years / 1e3)}k years`;
  if (years < 1e9) return `${Math.round(years / 1e6)}M years`;
  return `${(years / 1e9).toExponential(1)}B years`;
}
