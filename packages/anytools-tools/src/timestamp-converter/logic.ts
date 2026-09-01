import { format as formatDateFn } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

export type ParsedTimestamp = {
  date: Date;
  detectedFormat: 'unix-seconds' | 'unix-millis' | 'iso' | 'rfc2822' | 'unknown';
};

export function parseTimestamp(input: string): ParsedTimestamp {
  const trimmed = input.trim();
  if (/^\d{10}$/.test(trimmed)) {
    return { date: new Date(Number(trimmed) * 1000), detectedFormat: 'unix-seconds' };
  }
  if (/^\d{13}$/.test(trimmed)) {
    return { date: new Date(Number(trimmed)), detectedFormat: 'unix-millis' };
  }
  // Negative Unix timestamps — dates before 1970. The digit-count rules above cannot
  // match them, and falling through to `new Date('-86400')` makes the engine read the
  // string as a *year*, returning a date in 86399 CE labelled as RFC 2822. A bare
  // negative number is never valid in any of the other formats, so it is unambiguous
  // here; the seconds-vs-millis split follows the same >10-digit rule as positives.
  if (/^-\d{1,13}$/.test(trimmed)) {
    const digits = trimmed.length - 1;
    const value = Number(trimmed);
    return digits > 10
      ? { date: new Date(value), detectedFormat: 'unix-millis' }
      : { date: new Date(value * 1000), detectedFormat: 'unix-seconds' };
  }
  // ISO 8601 (also covers RFC 3339)
  const iso = new Date(trimmed);
  if (!Number.isNaN(iso.getTime())) {
    return { date: iso, detectedFormat: /^\d{4}-\d{2}-\d{2}T/.test(trimmed) ? 'iso' : 'rfc2822' };
  }
  throw new Error('Unrecognized timestamp format. Try Unix seconds/millis, ISO 8601, or RFC 2822.');
}

export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function toUnixMillis(date: Date): number {
  return date.getTime();
}

export function toIso(date: Date): string {
  return date.toISOString();
}

export function toRfc2822(date: Date): string {
  return date.toUTCString();
}

export function formatInZone(
  date: Date,
  timeZone: string,
  pattern = 'yyyy-MM-dd HH:mm:ss zzz',
): string {
  return formatInTimeZone(date, timeZone, pattern);
}

export function relativeFromNow(date: Date): string {
  const diffSec = (date.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diffSec);
  const sign = diffSec >= 0 ? 'in ' : '';
  const suffix = diffSec < 0 ? ' ago' : '';
  let label: string;
  if (abs < 60) label = `${Math.round(abs)} sec`;
  else if (abs < 3600) label = `${Math.round(abs / 60)} min`;
  else if (abs < 86_400) label = `${Math.round(abs / 3600)} hr`;
  else if (abs < 31_536_000) label = `${Math.round(abs / 86_400)} days`;
  else label = `${Math.round(abs / 31_536_000)} years`;
  return `${sign}${label}${suffix}`;
}

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

export { formatDateFn };
