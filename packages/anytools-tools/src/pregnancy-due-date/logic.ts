const DAY_MS = 86_400_000;

export type PregnancyResult = {
  dueDate: Date;
  weeks: number;
  days: number;
  trimester: 1 | 2 | 3;
  remainingDays: number;
};

/**
 * Add a whole number of days to a Date (immutable).
 */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/**
 * Format a Date as a long locale string (e.g. "January 1, 2025").
 * Uses `undefined` locale for user's system locale.
 */
export function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Naegele's rule: LMP + 280 days.
 * @param lmpDate - First day of last menstrual period
 * @param now - Current date (defaults to new Date(); injectable for testing)
 * @returns null when lmpDate is in the future or invalid
 */
export function calculatePregnancy(lmpDate: Date, now: Date = new Date()): PregnancyResult | null {
  if (Number.isNaN(lmpDate.getTime())) return null;

  const due = addDays(lmpDate, 280);
  const elapsedDays = Math.floor((now.getTime() - lmpDate.getTime()) / DAY_MS);
  const weeks = Math.floor(elapsedDays / 7);
  const days = elapsedDays % 7;
  const trimester: 1 | 2 | 3 = weeks < 13 ? 1 : weeks < 27 ? 2 : 3;
  const remainingDays = Math.max(0, Math.floor((due.getTime() - now.getTime()) / DAY_MS));

  return { dueDate: due, weeks, days, trimester, remainingDays };
}
