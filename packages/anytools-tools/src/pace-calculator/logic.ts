export const KM_PER_MILE = 1.609344;

export type Race = { name: string; km: number };

export const RACES: Race[] = [
  { name: '5K', km: 5 },
  { name: '10K', km: 10 },
  { name: 'Half marathon', km: 21.0975 },
  { name: 'Marathon', km: 42.195 },
];

export type PaceResult = {
  /** Seconds per kilometre */
  paceSecPerKm: number;
  /** Seconds per mile */
  paceSecPerMile: number;
};

/**
 * Format a duration in total seconds as h/m/s string.
 * Returns '—' for non-finite or non-positive values.
 */
export function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '—';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

/**
 * Format pace as "M:SS" per unit string.
 * Returns '—' for non-finite or non-positive values.
 */
export function formatPace(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Calculate running pace from distance and time.
 * @param distanceKm - Distance in kilometres (must be > 0)
 * @param totalSec - Total time in seconds
 */
export function calculatePace(distanceKm: number, totalSec: number): PaceResult {
  const paceSecPerKm = distanceKm > 0 ? totalSec / distanceKm : 0;
  const paceSecPerMile = paceSecPerKm * KM_PER_MILE;
  return { paceSecPerKm, paceSecPerMile };
}

/**
 * Convert a distance to kilometres given the unit.
 */
export function toKm(distance: number, unit: 'km' | 'mile'): number {
  return unit === 'km' ? distance : distance * KM_PER_MILE;
}
