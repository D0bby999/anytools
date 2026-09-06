/**
 * Discord message timestamps: `<t:UNIX_SECONDS:STYLE>`. Discord's client resolves this to text
 * at read time, in the READER's own locale and time zone — the same code renders differently
 * for two people in different zones, which is the entire point of using it over a plain typed
 * date. Styles are Discord's own — https://discord.com/developers/docs/reference#message-formatting-timestamp-styles
 */

import { ToolError } from '../shared/tool-error';
import { zoneOffsetMs } from '../shared/zone-offset';

export type TimestampStyle = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R';

export const TIMESTAMP_STYLES: TimestampStyle[] = ['t', 'T', 'd', 'D', 'f', 'F', 'R'];

/** A handful of zones to demonstrate "this renders differently for every reader" without the
 * visitor having to change their OS clock. */
export const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Ho_Chi_Minh',
  'Australia/Sydney',
];

/** `<input type="datetime-local">` gives "YYYY-MM-DDTHH:mm" (no seconds). */
export function parseDateTimeLocal(value: string): {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
} | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  return { y, mo, d, h, mi };
}

/**
 * The instant at which the given wall-clock fields are local time in `tz`, as Unix seconds.
 * Two passes: the UTC offset at the naive guess can differ from the offset at the real instant
 * across a DST change in `tz`, and the second pass settles it — the same technique
 * ../shared/zone-offset.ts's own doc comment describes, built only on its Intl-based
 * `zoneOffsetMs` (never on a plain `new Date(string)`, which reads in the machine's own zone).
 */
export function wallClockToEpochSeconds(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  tz: string,
): number {
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  const firstPass = naive - zoneOffsetMs(tz, new Date(naive));
  const secondPass = naive - zoneOffsetMs(tz, new Date(firstPass));
  return Math.floor(secondPass / 1000);
}

export function discordTimestamp(epochSeconds: number, style: TimestampStyle): string {
  return `<t:${epochSeconds}:${style}>`;
}

const STYLE_OPTIONS: Record<Exclude<TimestampStyle, 'R'>, Intl.DateTimeFormatOptions> = {
  t: { hour: 'numeric', minute: '2-digit' },
  T: { hour: 'numeric', minute: '2-digit', second: '2-digit' },
  d: { year: 'numeric', month: '2-digit', day: '2-digit' },
  D: { year: 'numeric', month: 'long', day: 'numeric' },
  f: { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' },
  F: {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  },
};

/** Below each threshold (seconds), format the difference as a count of the paired unit,
 * dividing by the paired number of seconds per unit. Ordered smallest to largest. */
const REL_UNITS: { belowSec: number; unit: Intl.RelativeTimeFormatUnit; unitSec: number }[] = [
  { belowSec: 60, unit: 'second', unitSec: 1 },
  { belowSec: 3600, unit: 'minute', unitSec: 60 },
  { belowSec: 86_400, unit: 'hour', unitSec: 3600 },
  { belowSec: 2_629_800, unit: 'day', unitSec: 86_400 }, // 2_629_800s ~= 1 month
  { belowSec: 31_557_600, unit: 'month', unitSec: 2_629_800 }, // 31_557_600s ~= 1 year
];
const YEAR_SECONDS = 31_557_600;

/** "in 3 hours" / "2 days ago", from `nowMs` — never reads the clock itself (see ui.tsx: the
 * caller supplies `now` from useClientNow so this never runs during a prerendered, clock-less
 * server render). */
export function relativeLabel(epochSeconds: number, nowMs: number, locale = 'en-US'): string {
  const diffSec = epochSeconds - Math.floor(nowMs / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const bucket = REL_UNITS.find((u) => abs < u.belowSec);
  if (bucket) return rtf.format(Math.round(diffSec / bucket.unitSec), bucket.unit);
  return rtf.format(Math.round(diffSec / YEAR_SECONDS), 'year');
}

/** Renders how a style would look to a reader in `viewerTz`, in `locale`. Mirrors what
 * Discord's own client does: format the same instant with the viewer's own zone and locale. */
export function previewText(
  epochSeconds: number,
  style: TimestampStyle,
  viewerTz: string,
  nowMs: number,
  locale = 'en-US',
): string {
  if (style === 'R') return relativeLabel(epochSeconds, nowMs, locale);
  return new Intl.DateTimeFormat(locale, { ...STYLE_OPTIONS[style], timeZone: viewerTz }).format(
    epochSeconds * 1000,
  );
}

export function requireValidDateTime(value: string): {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
} {
  const parsed = parseDateTimeLocal(value);
  if (!parsed) throw new ToolError('invalidDateTime', 'Pick a valid date and time.');
  return parsed;
}
