import { intervalToDuration } from 'date-fns';

export type CalendarDuration = { years: number; months: number; days: number };

/**
 * Whole years, months and days between two dates, `start` <= `end`, the way a person counts:
 * add whole years, then whole months (clamped to the month's end, so 31 Jan + 1 month is
 * 29 Feb), then the days left over.
 *
 * age-calculator and date-diff each carried a hand-rolled "borrow from the previous month"
 * loop that read the length of the wrong month — it decremented the cursor and then asked for
 * `new Date(y, cursor, 0)`, the last day of the month BEFORE that. 30 Apr → 1 May came out as
 * two days, 29 Feb 2024 → 1 Mar 2025 as a year and three days (measured 2026-09-05, 4 of 9
 * cases wrong against date-fns). date-fns already ships the correct arithmetic.
 */
export function calendarDuration(start: Date, end: Date): CalendarDuration {
  const d = intervalToDuration({ start, end });
  return { years: d.years ?? 0, months: d.months ?? 0, days: d.days ?? 0 };
}
