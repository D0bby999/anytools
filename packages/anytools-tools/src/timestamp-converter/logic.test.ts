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
