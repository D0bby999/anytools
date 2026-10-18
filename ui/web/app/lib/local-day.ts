/**
 * local-day.ts
 * The learner's calendar day as YYYY-MM-DD, in their own zone — the same
 * "today" the API computes with learning.LocalDay. An unknown zone falls back
 * to UTC rather than throwing: a wrong day is better than no page.
 */
export function localDay(timezone: string, now: Date = new Date()): string {
  const format = (timeZone: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  try {
    return format(timezone || "UTC");
  } catch {
    return format("UTC");
  }
}
