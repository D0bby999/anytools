import { calendarDuration } from '../shared/calendar-duration';

export type AgeResult = {
  years: number;
  months: number;
  days: number;
  totalDays: number;
  totalHours: number;
  totalMinutes: number;
};

/**
 * Computes exact age between two dates.
 * Handles month-end edge cases (e.g. born Jan 31, ref Mar 1) via shared/calendar-duration.
 * Returns null when birth is after ref (future dates).
 */
export function calcAge(birth: Date, ref: Date): AgeResult | null {
  if (birth > ref) return null;

  const { years, months, days } = calendarDuration(birth, ref);

  const ms = ref.getTime() - birth.getTime();
  const totalDays = Math.floor(ms / 86_400_000);
  const totalHours = Math.floor(ms / 3_600_000);
  const totalMinutes = Math.floor(ms / 60_000);

  return { years, months, days, totalDays, totalHours, totalMinutes };
}
