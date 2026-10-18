export type Phase = 'focus' | 'short' | 'long';

export const DURATIONS: Record<Phase, number> = {
  focus: 25 * 60,
  short: 5 * 60,
  long: 15 * 60,
};

export const LABELS: Record<Phase, string> = {
  focus: 'Focus',
  short: 'Short break',
  long: 'Long break',
};

/**
 * Formats a duration in seconds as MM:SS.
 */
export function fmtSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Computes the progress percentage for a phase given remaining seconds.
 * Returns 0–100 inclusive.
 */
export function phaseProgress(phase: Phase, remaining: number): number {
  const total = DURATIONS[phase];
  return ((total - remaining) / total) * 100;
}
