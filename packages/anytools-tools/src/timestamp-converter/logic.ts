import { format as formatDateFn } from 'date-fns';
import { formatInZone as formatInZoneIntl } from '../shared/zone-offset';

export type ParsedTimestamp = {
  date: Date;
  detectedFormat: 'unix-seconds' | 'unix-millis' | 'iso' | 'rfc2822' | 'unknown';
};

/**
 * A bare number is a Unix timestamp: up to 10 integer digits is seconds (through the year
 * 2286), 11-14 is milliseconds. Fractions of a second are kept.
 *
 * The earlier rule accepted exactly 10 or 13 digits and let everything else fall through to
 * `new Date(string)`, which reads a bare number as a YEAR: "0" became 2000-01-01, "86400" became
 * the year 86400, and 946684800 (1 Jan 2000, nine digits) was "unrecognized". Negative values
 * (before 1970) follow the same split.
 */
const UNIX_NUMBER = /^-?(\d+)(?:\.\d+)?$/;

export function parseTimestamp(input: string): ParsedTimestamp {
  const trimmed = input.trim();
  const numeric = UNIX_NUMBER.exec(trimmed);
  if (numeric) {
    const digits = (numeric[1] as string).length;
    if (digits > 14) {
      throw new Error('That number is too large for a Unix timestamp in seconds or milliseconds.');
    }
    const value = Number(trimmed);
    return digits > 10
      ? { date: new Date(Math.trunc(value)), detectedFormat: 'unix-millis' }
      : { date: new Date(Math.round(value * 1000)), detectedFormat: 'unix-seconds' };
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
  // Intl-based: date-fns-tz's formatter is an hour out on the machine's own DST-change day.
  return formatInZoneIntl(date, timeZone, pattern);
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
