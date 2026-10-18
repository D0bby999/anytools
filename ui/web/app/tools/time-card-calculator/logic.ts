/** Regular hours threshold for US FLSA overtime. */
export const WEEKLY_OT_THRESHOLD = 40;
/** Overtime multiplier per US FLSA. */
export const OT_MULTIPLIER = 1.5;

export type TimeCardDay = {
  label: string;
  in: string;
  out: string;
  break: number; // break minutes
};

export type WeekSummary = {
  totalHours: number;
  regularHours: number;
  overtimeHours: number;
  grossPay: number;
};

/**
 * Parses an HH:MM time string into total minutes since midnight.
 * Returns null for empty / invalid input.
 */
export function parseHM(s: string): number | null {
  if (!s) return null;
  const parts = s.split(':');
  const hh = parts[0] ?? '0';
  const mm = parts[1] ?? '0';
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/**
 * Computes worked hours for a single day entry.
 * Handles overnight shifts (out < in wraps +24 h).
 * Subtracts break minutes, floors at 0.
 */
export function dayHours(day: TimeCardDay): number {
  const a = parseHM(day.in);
  const b = parseHM(day.out);
  if (a === null || b === null) return 0;
  let mins = b - a;
  if (mins < 0) mins += 24 * 60; // overnight wrap
  mins -= day.break;
  return Math.max(0, mins) / 60;
}

/**
 * Summarises a week of time card entries.
 * Applies US FLSA 1.5× overtime for hours over 40.
 */
export function summariseWeek(days: TimeCardDay[], hourlyRate: number): WeekSummary {
  const totalHours = days.reduce((sum, d) => sum + dayHours(d), 0);
  const regularHours = Math.min(totalHours, WEEKLY_OT_THRESHOLD);
  const overtimeHours = Math.max(0, totalHours - WEEKLY_OT_THRESHOLD);
  const grossPay = regularHours * hourlyRate + overtimeHours * hourlyRate * OT_MULTIPLIER;
  return { totalHours, regularHours, overtimeHours, grossPay };
}
