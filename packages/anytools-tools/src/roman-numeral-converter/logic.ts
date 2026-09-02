/**
 * Roman numerals, both directions.
 * Implemented from the standard subtractive notation rules; no third-party source consulted.
 */

export class RomanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RomanError';
  }
}

export const MIN_ROMAN = 1;
/** Standard notation has no symbol above M, so 3999 (MMMCMXCIX) is the ceiling. */
export const MAX_ROMAN = 3999;

// Subtractive pairs are listed inline so the greedy loop below produces IV rather than IIII.
const TABLE: [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

const VALUES: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

export function toRoman(n: number): string {
  if (!Number.isInteger(n)) throw new RomanError('Roman numerals represent whole numbers only.');
  if (n < MIN_ROMAN || n > MAX_ROMAN) {
    throw new RomanError(
      `Standard Roman numerals cover ${MIN_ROMAN} to ${MAX_ROMAN}. There is no symbol above M, so larger numbers need overlines this tool does not produce.`,
    );
  }
  let rest = n;
  let out = '';
  for (const [value, symbol] of TABLE) {
    while (rest >= value) {
      out += symbol;
      rest -= value;
    }
  }
  return out;
}

export function fromRoman(input: string): number {
  const s = input.trim().toUpperCase();
  if (!s) throw new RomanError('Enter a Roman numeral.');
  for (const ch of s) {
    if (!(ch in VALUES)) throw new RomanError(`"${ch}" is not a Roman numeral symbol.`);
  }

  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const current = VALUES[s[i] as string] as number;
    const next = i + 1 < s.length ? (VALUES[s[i + 1] as string] as number) : 0;
    // A smaller symbol before a larger one is subtractive: IX is 9, not 11.
    total += current < next ? -current : current;
  }

  // Round-trip as the validity check. It is the only rule that rejects IIII, IM, VX and
  // XXXX at once, and it cannot disagree with toRoman by construction.
  if (total < MIN_ROMAN || total > MAX_ROMAN || toRoman(total) !== s) {
    throw new RomanError(
      `"${input.trim()}" is not valid standard notation.${
        total >= MIN_ROMAN && total <= MAX_ROMAN
          ? ` Did you mean ${toRoman(total)} (${total})?`
          : ''
      }`,
    );
  }
  return total;
}
