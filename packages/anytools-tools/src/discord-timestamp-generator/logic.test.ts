import { describe, expect, it } from 'vitest';
import {
  discordTimestamp,
  parseDateTimeLocal,
  previewText,
  relativeLabel,
  requireValidDateTime,
  wallClockToEpochSeconds,
} from './logic';

describe('parseDateTimeLocal', () => {
  it('parses a datetime-local value', () => {
    expect(parseDateTimeLocal('2026-05-25T12:30')).toEqual({
      y: 2026,
      mo: 5,
      d: 25,
      h: 12,
      mi: 30,
    });
  });

  it('rejects malformed or empty input', () => {
    expect(parseDateTimeLocal('')).toBeNull();
    expect(parseDateTimeLocal('2026-05-25')).toBeNull();
    expect(parseDateTimeLocal('not a date')).toBeNull();
  });
});

describe('requireValidDateTime', () => {
  it('returns the parsed fields for valid input', () => {
    expect(requireValidDateTime('2026-01-01T00:00')).toEqual({ y: 2026, mo: 1, d: 1, h: 0, mi: 0 });
  });

  it('throws a ToolError for invalid input', () => {
    expect(() => requireValidDateTime('garbage')).toThrow('Pick a valid date and time.');
  });
});

describe('wallClockToEpochSeconds', () => {
  it('treats UTC wall-clock time as itself', () => {
    // 2026-01-01T00:00 UTC is exactly 1767225600 (a known Unix epoch second value).
    expect(wallClockToEpochSeconds(2026, 1, 1, 0, 0, 'UTC')).toBe(1767225600);
  });

  it('converts a wall-clock time in a positive-offset zone back to UTC seconds', () => {
    // 07:00 in Asia/Ho_Chi_Minh (UTC+7, no DST) is 00:00 UTC the same day.
    const inZone = wallClockToEpochSeconds(2026, 1, 1, 7, 0, 'Asia/Ho_Chi_Minh');
    const inUtc = wallClockToEpochSeconds(2026, 1, 1, 0, 0, 'UTC');
    expect(inZone).toBe(inUtc);
  });

  it('converts a wall-clock time in a negative-offset zone back to UTC seconds', () => {
    // 2026-01-01 is outside US DST, so America/New_York is a fixed UTC-5.
    const inZone = wallClockToEpochSeconds(2026, 1, 1, 0, 0, 'America/New_York');
    const inUtc = wallClockToEpochSeconds(2026, 1, 1, 5, 0, 'UTC');
    expect(inZone).toBe(inUtc);
  });
});

describe('discordTimestamp', () => {
  it('wraps the epoch and style in Discord message-formatting syntax', () => {
    expect(discordTimestamp(1767225600, 'F')).toBe('<t:1767225600:F>');
    expect(discordTimestamp(0, 'R')).toBe('<t:0:R>');
  });
});

describe('relativeLabel', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);

  it('formats a future instant a few hours away', () => {
    const future = Math.floor(now / 1000) + 3 * 3600;
    expect(relativeLabel(future, now)).toBe('in 3 hours');
  });

  it('formats a past instant a couple of days ago', () => {
    const past = Math.floor(now / 1000) - 2 * 86_400;
    expect(relativeLabel(past, now)).toBe('2 days ago');
  });

  it('formats "now" for the current second', () => {
    expect(relativeLabel(Math.floor(now / 1000), now)).toBe('now');
  });
});

describe('previewText', () => {
  const epoch = Date.UTC(2026, 3, 20, 16, 20, 0) / 1000; // 20 Apr 2026, 16:20 UTC

  it('renders the short time style in the requested zone', () => {
    expect(previewText(epoch, 't', 'UTC', Date.now())).toMatch(/4:20/);
  });

  it('renders the same instant differently in two different zones', () => {
    const utc = previewText(epoch, 'F', 'UTC', Date.now());
    const tokyo = previewText(epoch, 'F', 'Asia/Tokyo', Date.now());
    // Tokyo is UTC+9, so 16:20 UTC is already the next clock-hour there — the two renders
    // must not be identical, which is the whole "renders per-reader" premise of the tool.
    expect(utc).not.toBe(tokyo);
  });

  it('delegates the R style to relativeLabel', () => {
    const now = Date.UTC(2026, 3, 20, 16, 20, 0);
    const soon = epoch + 3600;
    expect(previewText(soon, 'R', 'UTC', now)).toBe(relativeLabel(soon, now));
  });
});
