import { ToolError } from '../shared/tool-error';
import { formatInZone, offsetLabel as zoneOffsetLabel, zoneOffsetMs } from '../shared/zone-offset';

export const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'America/Chicago',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Africa/Cairo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Ho_Chi_Minh',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
];

export function formatAtZone(date: Date, tz: string, pattern = 'yyyy-MM-dd HH:mm:ss xxx'): string {
  return formatInZone(date, tz, pattern);
}

export function offsetLabel(tz: string, date: Date = new Date()): string {
  return zoneOffsetLabel(tz, date);
}

/**
 * The instant at which `wallClock` ("YYYY-MM-DDTHH:mm[:ss]") is the local time in `tz`.
 *
 * Never touches the machine's own zone. The previous version went through `new Date(string)`,
 * which the engine reads in the machine's zone, so "09:00 Asia/Ho_Chi_Minh" converted correctly
 * on a UTC server and came out seven hours wrong for anyone sitting in Vietnam. date-fns-tz's
 * `fromZonedTime` and `getTimezoneOffset` still build a local Date underneath and are an hour
 * out on the day the MACHINE's zone changes DST, so the offset comes from shared/zone-offset.
 *
 * So the fields are taken as UTC and corrected by the zone's offset. Two passes, because the
 * offset at the naive instant can differ from the offset at the real one across a DST change
 * in `tz` itself; the second pass settles it, and a wall-clock time inside a spring-forward gap
 * resolves to the offset in force after the gap.
 */
export function wallClockToInstant(wallClock: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(wallClock.trim());
  if (!m) throw new ToolError('isoFormat', 'Use ISO format: YYYY-MM-DDTHH:mm');
  const [, y, mo, d, h, mi, s] = m.map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const naive = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  if (Number.isNaN(naive)) throw new ToolError('isoFormat', 'Use ISO format: YYYY-MM-DDTHH:mm');
  const first = naive - zoneOffsetMs(tz, new Date(naive));
  const second = naive - zoneOffsetMs(tz, new Date(first));
  return new Date(second);
}

export function meetingTable(
  localDateTime: string,
  fromTz: string,
  targetTzs: string[],
): { tz: string; time: string; offset: string }[] {
  const instant = wallClockToInstant(localDateTime, fromTz);
  return targetTzs.map((tz) => ({
    tz,
    time: formatInZone(instant, tz, 'yyyy-MM-dd HH:mm xxx'),
    offset: offsetLabel(tz, instant),
  }));
}
