import { dateLocale } from "~/components/ui/date-text";

/**
 * A calendar day (YYYY-MM-DD, a learner's local day) as a reader says it.
 * Read at UTC midnight and printed in UTC, so the server and the browser
 * print the same day whatever zone each is in.
 */
export function dayLabel(
  day: string,
  language: string,
  parts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" },
) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(dateLocale(language), { ...parts, timeZone: "UTC" });
}
