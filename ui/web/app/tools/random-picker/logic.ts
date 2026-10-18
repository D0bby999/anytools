/** Pure random-picker logic. All functions accept an injectable RNG for testability. */

/** Minimal RNG interface — matches the signature of Math.random. */
export type Rng = () => number;

/** Roll `count` dice each with `sides` sides. Returns individual rolls and their sum. */
export function rollDice(
  count: number,
  sides: number,
  rng: Rng = Math.random,
): { rolls: number[]; sum: number } {
  const rolls = Array.from({ length: count }, () => Math.floor(rng() * sides) + 1);
  const sum = rolls.reduce((a, b) => a + b, 0);
  return { rolls, sum };
}

/** Flip a coin. Returns 'Heads' or 'Tails'. */
export function flipCoin(rng: Rng = Math.random): 'Heads' | 'Tails' {
  return rng() < 0.5 ? 'Heads' : 'Tails';
}

/**
 * Generate a random integer in the inclusive range [min, max].
 * If min > max they are swapped.
 */
export function randomInt(min: number, max: number, rng: Rng = Math.random): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

/**
 * Pick one item at random from a non-empty array.
 * Returns undefined for an empty array.
 */
export function pickOne<T>(items: T[], rng: Rng = Math.random): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rng() * items.length)];
}

/** Parse a newline-delimited list string into trimmed, non-empty items. */
export function parseListItems(raw: string): string[] {
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}
