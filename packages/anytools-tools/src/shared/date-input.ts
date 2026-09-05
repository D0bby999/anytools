/**
 * `<input type="date">` gives "YYYY-MM-DD". `new Date("YYYY-MM-DD")` reads that as MIDNIGHT UTC,
 * which in any zone west of Greenwich is the evening of the day before — so for a user in the
 * Americas the age, date-diff and pregnancy tools were working from the wrong calendar day
 * (measured 2026-09-05 under TZ=America/Los_Angeles). The tools count calendar days in the
 * user's own zone, so the input has to be read as local midnight.
 */
export function parseDateInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  // new Date(2024, 1, 31) silently rolls to 2 March; refuse rather than accept a different day.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/** Today as an input value, in the user's zone. `toISOString().slice(0, 10)` is UTC's today. */
export function todayInputValue(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
