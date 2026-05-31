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
 * Handles month-end edge cases (e.g. born Jan 31, ref Mar 1).
 * Returns null when birth is after ref (future dates).
 */
export function calcAge(birth: Date, ref: Date): AgeResult | null {
  if (birth > ref) return null;

  let years = ref.getFullYear() - birth.getFullYear();
  let months = ref.getMonth() - birth.getMonth();
  let days = ref.getDate() - birth.getDate();

  // Borrow months until days is non-negative. A loop handles rare cases where
  // birth-day > days in the preceding month (e.g. born Jan 31, ref Mar 1:
  // Feb has 29 days in 2000 → -30+29=-1, so borrow again: Jan has 31 → -1+31=30).
  // We track which month to borrow from by decrementing a running month cursor.
  let borrowMonth = ref.getMonth(); // cursor: the month we borrow from
  while (days < 0) {
    months -= 1;
    borrowMonth -= 1;
    // new Date(y, m, 0) gives the last day of month m-1
    const daysInBorrowedMonth = new Date(ref.getFullYear(), borrowMonth, 0).getDate();
    days += daysInBorrowedMonth;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const ms = ref.getTime() - birth.getTime();
  const totalDays = Math.floor(ms / 86_400_000);
  const totalHours = Math.floor(ms / 3_600_000);
  const totalMinutes = Math.floor(ms / 60_000);

  return { years, months, days, totalDays, totalHours, totalMinutes };
}
