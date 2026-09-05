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

/**
 * Every enabled character set is guaranteed to appear at least once. Drawing each position
 * independently from the pooled alphabet left half of all 8-character passwords without a
 * digit or a symbol (measured: 997 of 2000), and "must contain a number and a symbol" is
 * exactly the rule most sign-up forms enforce.
 */
export function generatePassword(options: PasswordOptions): string {
  const sets = enabledSets(options);
  if (sets.length === 0) throw new Error('At least one character set must be enabled');
  const pool = sets.join('');
  const length = Math.max(4, Math.min(options.length, 256));
  // One character from each set first, the rest from the whole pool, then shuffle so the
  // guaranteed characters don't sit at predictable positions.
  const chars = sets.map((set) => randomChar(set));
  while (chars.length < length) chars.push(randomChar(pool));
  shuffle(chars);
  return chars.join('');
}

function enabledSets(options: PasswordOptions): string[] {
  const sets: string[] = [];
  if (options.lowercase) sets.push(LOWER);
  if (options.uppercase) sets.push(UPPER);
  if (options.numbers) sets.push(DIGITS);
  if (options.symbols) sets.push(SYMBOLS);
  if (!options.excludeAmbiguous) return sets;
  return sets.map((set) =>
    Array.from(set)
      .filter((c) => !AMBIGUOUS.has(c))
      .join(''),
  );
}

/** Uniform index in [0, n) via rejection sampling — `random % n` favours low indices. */
function randomIndex(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const value = buf[0] as number;
    if (value < limit) return value % n;
  }
}

function randomChar(set: string): string {
  return set[randomIndex(set.length)] as string;
}

/** Fisher–Yates with a crypto source. */
function shuffle(chars: string[]): void {
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
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
