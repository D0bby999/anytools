/**
 * UTC offset of an IANA zone at an instant, computed with Intl and nothing else.
 *
 * date-fns-tz's `getTimezoneOffset` and `fromZonedTime` build a local `Date` on the way, so on
 * the day the MACHINE's zone changes DST they are an hour out for every other zone (measured
 * 2026-09-05: 10 March 2024 under TZ=America/Los_Angeles). Intl formats the instant directly in
 * the requested zone, so the result is the same on every machine.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let dtf = formatters.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, dtf);
  }
  return dtf;
}

/** Milliseconds east of UTC (Asia/Ho_Chi_Minh → +25 200 000; America/New_York in January → -18 000 000). */
export function zoneOffsetMs(tz: string, date: Date): number {
  const fields: Record<string, number> = {};
  for (const { type, value } of formatterFor(tz).formatToParts(date)) {
    if (type !== 'literal') fields[type] = Number(value);
  }
  const asUtc = Date.UTC(
    fields.year ?? 1970,
    (fields.month ?? 1) - 1,
    fields.day ?? 1,
    fields.hour ?? 0,
    fields.minute ?? 0,
    fields.second ?? 0,
  );
  // Compare whole seconds: the formatter carries no milliseconds.
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** "+07:00" / "-04:00" for the zone's offset at `date`. */
export function offsetLabel(tz: string, date: Date): string {
  const minutes = Math.round(zoneOffsetMs(tz, date) / 60_000);
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Short zone name at an instant: "GMT+7", "EDT", "UTC". */
function zoneAbbreviation(tz: string, date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName');
  return parts?.value ?? tz;
}

/**
 * Format an instant in a zone. Supports the date-fns tokens the tools use — yyyy MM dd HH mm ss,
 * xxx (the ±HH:mm offset) and zzz (the short zone name) — through Intl alone, for the same
 * reason as `zoneOffsetMs`: date-fns-tz's `formatInTimeZone` is an hour out on the machine's
 * own DST-change day.
 */
export function formatInZone(date: Date, tz: string, pattern: string): string {
  const fields: Record<string, string> = {};
  for (const { type, value } of formatterFor(tz).formatToParts(date)) {
    if (type !== 'literal') fields[type] = value;
  }
  const tokens: Record<string, string> = {
    yyyy: fields.year ?? '',
    MM: fields.month ?? '',
    dd: fields.day ?? '',
    HH: fields.hour ?? '',
    mm: fields.minute ?? '',
    ss: fields.second ?? '',
    xxx: offsetLabel(tz, date),
    zzz: zoneAbbreviation(tz, date),
  };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss|xxx|zzz/g, (t) => tokens[t] ?? t);
}
