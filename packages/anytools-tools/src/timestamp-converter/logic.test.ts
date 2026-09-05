import { describe, expect, it } from 'vitest';
import {
  formatInZone,
  parseTimestamp,
  relativeFromNow,
  toIso,
  toRfc2822,
  toUnixMillis,
  toUnixSeconds,
} from './logic';

describe('parseTimestamp', () => {
  it('detects Unix seconds (10-digit)', () => {
    const out = parseTimestamp('1234567890');
    expect(out.detectedFormat).toBe('unix-seconds');
    expect(out.date.toISOString()).toBe('2009-02-13T23:31:30.000Z');
  });

  it('detects Unix millis (13-digit)', () => {
    const out = parseTimestamp('1234567890123');
    expect(out.detectedFormat).toBe('unix-millis');
    expect(out.date.toISOString()).toBe('2009-02-13T23:31:30.123Z');
  });

  it('parses ISO 8601', () => {
    const out = parseTimestamp('2026-05-25T12:00:00Z');
    expect(out.detectedFormat).toBe('iso');
    expect(out.date.toISOString()).toBe('2026-05-25T12:00:00.000Z');
  });

  it('parses RFC 2822-ish', () => {
    const out = parseTimestamp('Mon, 25 May 2026 12:00:00 GMT');
    expect(out.detectedFormat).toBe('rfc2822');
    expect(out.date.toISOString()).toBe('2026-05-25T12:00:00.000Z');
  });

  it('throws on garbage', () => {
    expect(() => parseTimestamp('not a date')).toThrow(/Unrecognized timestamp/);
  });
});

describe('conversions', () => {
  const fixed = new Date('2026-05-25T12:00:00Z');

  it('toUnixSeconds', () => {
    expect(toUnixSeconds(fixed)).toBe(1779710400);
  });
  it('toUnixMillis', () => {
    expect(toUnixMillis(fixed)).toBe(1779710400000);
  });
  it('toIso', () => {
    expect(toIso(fixed)).toBe('2026-05-25T12:00:00.000Z');
  });
  it('toRfc2822 returns UTC string', () => {
    expect(toRfc2822(fixed)).toMatch(/GMT/);
  });
  it('formatInZone HCM offset', () => {
    const out = formatInZone(fixed, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm xxx');
    expect(out).toBe('2026-05-25 19:00 +07:00');
  });
});

describe('relativeFromNow', () => {
  it('past time uses ago suffix', () => {
    const past = new Date(Date.now() - 3600_000);
    expect(relativeFromNow(past)).toMatch(/ago$/);
  });
  it('future time uses in prefix', () => {
    const future = new Date(Date.now() + 86_400_000);
    expect(relativeFromNow(future)).toMatch(/^in /);
  });
});

describe('negative Unix timestamps (pre-1970)', () => {
  // These fell through the 10-and-13-digit rules and reached `new Date('-86400')`,
  // which the engine reads as a YEAR — returning a date in 86399 CE labelled rfc2822.
  it('reads -86400 as one day before the epoch', () => {
    const r = parseTimestamp('-86400');
    expect(r.detectedFormat).toBe('unix-seconds');
    expect(r.date.toISOString()).toBe('1969-12-31T00:00:00.000Z');
  });

  it('reads a nine-digit negative as seconds', () => {
    const r = parseTimestamp('-315619200');
    expect(r.detectedFormat).toBe('unix-seconds');
    expect(r.date.getUTCFullYear()).toBe(1960);
  });

  it('reads a thirteen-digit negative as milliseconds', () => {
    const ms = parseTimestamp('-1234567890123');
    expect(ms.detectedFormat).toBe('unix-millis');
    expect(ms.date.getUTCFullYear()).toBe(1930);
  });

  it('still rejects genuine nonsense', () => {
    expect(() => parseTimestamp('not a date')).toThrow();
  });
});

// Review 2026-09-05: "0" parsed as the year 2000 and 1 Jan 2000 in seconds was rejected.
describe('Unix timestamps of any length', () => {
  it('reads short positive values as seconds', () => {
    expect(parseTimestamp('0').date.toISOString()).toBe('1970-01-01T00:00:00.000Z');
    expect(parseTimestamp('86400').date.toISOString()).toBe('1970-01-02T00:00:00.000Z');
    expect(parseTimestamp('946684800').date.toISOString()).toBe('2000-01-01T00:00:00.000Z');
    expect(parseTimestamp('946684800').detectedFormat).toBe('unix-seconds');
  });
  it('reads 11-14 digit values as milliseconds', () => {
    expect(parseTimestamp('946684800000').date.toISOString()).toBe('2000-01-01T00:00:00.000Z');
    expect(parseTimestamp('946684800000').detectedFormat).toBe('unix-millis');
  });
  it('keeps fractional seconds', () => {
    expect(parseTimestamp('1700000000.5').date.toISOString()).toBe('2023-11-14T22:13:20.500Z');
  });
  it('refuses a number with more digits than milliseconds can have', () => {
    expect(() => parseTimestamp('123456789012345')).toThrow(/too large/);
  });
});
