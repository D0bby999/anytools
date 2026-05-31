import { formatInTimeZone, getTimezoneOffset } from 'date-fns-tz';

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
  return formatInTimeZone(date, tz, pattern);
}

export function offsetLabel(tz: string, date: Date = new Date()): string {
  const ms = getTimezoneOffset(tz, date);
  const hours = ms / (1000 * 60 * 60);
  const sign = hours >= 0 ? '+' : '-';
  const abs = Math.abs(hours);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function meetingTable(
  localDateTime: string,
  fromTz: string,
  targetTzs: string[],
): { tz: string; time: string; offset: string }[] {
  // Parse localDateTime as a wall-clock time in fromTz
  const [date, time] = localDateTime.split('T');
  if (!date || !time) throw new Error('Use ISO format: YYYY-MM-DDTHH:mm');
  // Build a Date that represents the instant when `localDateTime` is the wall clock at `fromTz`
  const fromOffsetMs = getTimezoneOffset(fromTz, new Date(localDateTime));
  const naive = new Date(localDateTime);
  const instant = new Date(naive.getTime() - fromOffsetMs);
  return targetTzs.map((tz) => ({
    tz,
    time: formatInTimeZone(instant, tz, 'yyyy-MM-dd HH:mm xxx'),
    offset: offsetLabel(tz, instant),
  }));
}
