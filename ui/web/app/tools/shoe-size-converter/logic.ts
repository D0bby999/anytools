export type Demographic = 'men' | 'women';
export type System = 'us' | 'eu' | 'uk' | 'cm';

export type ShoeSizeRow = { us: number; eu: number; uk: number; cm: number };

// Approximate mappings — common adult sizes
export const MEN: ShoeSizeRow[] = [
  { us: 6, eu: 39, uk: 5.5, cm: 24.0 },
  { us: 7, eu: 40, uk: 6.5, cm: 24.6 },
  { us: 8, eu: 41, uk: 7.5, cm: 25.4 },
  { us: 9, eu: 42, uk: 8.5, cm: 26.0 },
  { us: 10, eu: 43, uk: 9.5, cm: 26.7 },
  { us: 11, eu: 44, uk: 10.5, cm: 27.5 },
  { us: 12, eu: 45, uk: 11.5, cm: 28.3 },
  { us: 13, eu: 46, uk: 12.5, cm: 29.0 },
];

export const WOMEN: ShoeSizeRow[] = [
  { us: 5, eu: 35, uk: 2.5, cm: 22.0 },
  { us: 6, eu: 36, uk: 3.5, cm: 22.5 },
  { us: 7, eu: 37, uk: 4.5, cm: 23.0 },
  { us: 8, eu: 38, uk: 5.5, cm: 23.8 },
  { us: 9, eu: 39, uk: 6.5, cm: 24.5 },
  { us: 10, eu: 40, uk: 7.5, cm: 25.4 },
  { us: 11, eu: 41, uk: 8.5, cm: 26.2 },
];

/** Returns the row whose `system` value is closest to `value`. */
export function findClosest(demographic: Demographic, system: System, value: number): ShoeSizeRow {
  const chart = demographic === 'men' ? MEN : WOMEN;
  return chart.reduce((best, row) => {
    const dist = Math.abs(row[system] - value);
    const bestDist = Math.abs(best[system] - value);
    return dist < bestDist ? row : best;
  });
}
