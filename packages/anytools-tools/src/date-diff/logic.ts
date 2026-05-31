export type DateDiffResult = {
  years: number;
  months: number;
  days: number;
  totalDays: number;
  totalWeeks: number;
  totalHours: number;
};

/**
 * Computes the difference between two dates.
 * Always returns a non-negative result regardless of argument order.
 */
export function dateDiff(start: Date, end: Date): DateDiffResult {
  const [a, b] = start <= end ? [start, end] : [end, start];

  let years = b.getFullYear() - a.getFullYear();
  let months = b.getMonth() - a.getMonth();
  let days = b.getDate() - a.getDate();

  // Borrow months until days is non-negative (mirrors age-calculator borrow logic).
  let borrowMonth = b.getMonth();
  while (days < 0) {
    months -= 1;
    borrowMonth -= 1;
    days += new Date(b.getFullYear(), borrowMonth, 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const ms = b.getTime() - a.getTime();
  return {
    years,
    months,
    days,
    totalDays: Math.floor(ms / 86_400_000),
    totalWeeks: Math.floor(ms / (7 * 86_400_000)),
    totalHours: Math.floor(ms / 3_600_000),
  };
}
