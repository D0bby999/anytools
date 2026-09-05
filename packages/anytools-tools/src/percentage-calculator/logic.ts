export type PercentMode = 'percentOf' | 'whatPercent' | 'change';

export type PercentResult = {
  value: number;
  /** English phrasing of the calculation; widgets rebuild it from `mode`, `a`, `b` instead. */
  label: string;
  unit: string;
  mode: PercentMode;
  a: number;
  b: number;
};

/**
 * "X% of Y" — what is X percent of Y?
 * e.g. 20% of 150 = 30
 */
export function percentOf(x: number, y: number): number {
  return (x / 100) * y;
}

/**
 * "X is what percent of Y?" — returns the percentage.
 * Returns 0 when Y is 0 to avoid division by zero.
 */
export function whatPercent(x: number, y: number): number {
  if (y === 0) return 0;
  return (x / y) * 100;
}

/**
 * Percent change from X to Y.
 * Returns 0 when X is 0 to avoid division by zero.
 * Positive = increase, negative = decrease.
 */
export function percentChange(from: number, to: number): number {
  if (from === 0) return 0;
  return ((to - from) / from) * 100;
}

/**
 * Dispatches to the correct formula based on mode and returns
 * a value + display metadata.
 */
export function calcPercent(mode: PercentMode, a: number, b: number): PercentResult {
  switch (mode) {
    case 'percentOf':
      return { value: percentOf(a, b), label: `${a}% of ${b}`, unit: '', mode, a, b };
    case 'whatPercent':
      return { value: whatPercent(a, b), label: `${a} is X% of ${b}`, unit: '%', mode, a, b };
    case 'change':
      return {
        value: percentChange(a, b),
        label: `Change from ${a} to ${b}`,
        unit: '%',
        mode,
        a,
        b,
      };
  }
}
