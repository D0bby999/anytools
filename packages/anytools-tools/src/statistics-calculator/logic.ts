/** Pure statistics calculation logic. */

export type PopulationType = 'population' | 'sample';

export type StatsResult = {
  n: number;
  sum: number;
  mean: number;
  median: number;
  modes: number[];
  min: number;
  max: number;
  range: number;
  variance: number;
  stdDev: number;
  q1: number;
  q3: number;
};

/**
 * Compute descriptive statistics for a numeric array.
 * Returns null for empty arrays.
 *
 * Variance: sample uses (n-1) denominator; population uses (n).
 */
export function computeStats(nums: number[], pop: PopulationType): StatsResult | null {
  const n = nums.length;
  if (n === 0) return null;

  const sorted = [...nums].sort((a, b) => a - b);
  const sum = nums.reduce((a, b) => a + b, 0);
  const mean = sum / n;

  // Median via linear interpolation
  let median = 0;
  if (n % 2 === 1) median = sorted[Math.floor(n / 2)] ?? 0;
  else median = ((sorted[n / 2 - 1] ?? 0) + (sorted[n / 2] ?? 0)) / 2;

  // Mode: collect all values with the highest frequency
  const counts = new Map<number, number>();
  for (const v of nums) counts.set(v, (counts.get(v) ?? 0) + 1);
  // Use a loop instead of Math.max(...spread) to avoid stack overflow on large arrays
  let maxCount = 0;
  for (const c of counts.values()) if (c > maxCount) maxCount = c;
  const modes: number[] = [];
  for (const [v, c] of counts.entries()) if (c === maxCount) modes.push(v);

  const sqDiff = nums.reduce((a, b) => a + (b - mean) ** 2, 0);
  const variance = pop === 'population' ? sqDiff / n : sqDiff / Math.max(n - 1, 1);
  const stdDev = Math.sqrt(variance);

  // Quartile via linear interpolation at fractional index
  const percentile = (p: number): number => {
    const i = p * (n - 1);
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return (sorted[lo] ?? 0) + (i - lo) * ((sorted[hi] ?? 0) - (sorted[lo] ?? 0));
  };

  return {
    n,
    sum,
    mean,
    median,
    modes,
    min: sorted[0] ?? 0,
    max: sorted[n - 1] ?? 0,
    range: (sorted[n - 1] ?? 0) - (sorted[0] ?? 0),
    variance,
    stdDev,
    q1: percentile(0.25),
    q3: percentile(0.75),
  };
}

/** Parse a string of comma/space/newline-separated numbers into a number array. */
export function parseNumbers(input: string): number[] {
  return input
    .split(/[\s,;]+/)
    .map((s) => Number.parseFloat(s))
    .filter((n) => Number.isFinite(n));
}
