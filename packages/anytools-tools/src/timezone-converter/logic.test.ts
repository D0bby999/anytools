import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatAtZone, meetingTable, offsetLabel, wallClockToInstant } from './logic';

describe('formatAtZone', () => {
  it('formats date in target timezone', () => {
    const d = new Date('2026-05-26T12:00:00Z');
    expect(formatAtZone(d, 'Asia/Ho_Chi_Minh', 'HH:mm xxx')).toBe('19:00 +07:00');
    expect(formatAtZone(d, 'UTC', 'HH:mm xxx')).toBe('12:00 +00:00');
  });
});

describe('offsetLabel', () => {
  it('Asia/Ho_Chi_Minh is +07:00', () => {
    expect(offsetLabel('Asia/Ho_Chi_Minh', new Date('2026-05-26T12:00:00Z'))).toBe('+07:00');
  });
  it('UTC is +00:00', () => {
    expect(offsetLabel('UTC', new Date('2026-05-26T12:00:00Z'))).toBe('+00:00');
  });
});

describe('meetingTable', () => {
  it('shows time across zones', () => {
    const out = meetingTable('2026-05-26T10:00', 'America/New_York', [
      'Asia/Ho_Chi_Minh',
      'Europe/London',
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.tz).toBe('Asia/Ho_Chi_Minh');
  });
});

// Review 2026-09-05: the conversion depended on the machine's zone. Node re-reads TZ when
// process.env.TZ changes, so the same table is checked from three different machines.
describe('meetingTable is independent of the machine time zone', () => {
  afterEach(() => vi.unstubAllEnvs());

  // 10 March 2024 is the US spring-forward day: the case that trips a local-Date approach
  // when the MACHINE is in America/Los_Angeles.
  it.each(['UTC', 'Asia/Ho_Chi_Minh', 'America/Los_Angeles'])('under TZ=%s', (tz) => {
    vi.stubEnv('TZ', tz);
    const [utc] = meetingTable('2024-03-10T09:00', 'Asia/Ho_Chi_Minh', ['UTC']);
    expect(utc?.time).toBe('2024-03-10 02:00 +00:00');
    const [london] = meetingTable('2024-01-10T09:00', 'America/New_York', ['Europe/London']);
    expect(london?.time).toBe('2024-01-10 14:00 +00:00');
  });

  it('resolves a DST change in the SOURCE zone, including the spring-forward gap', () => {
    // New York, 10 March 2024: 01:59 EST is 06:59Z; 03:00 EDT is 07:00Z; 02:30 does not exist
    // and lands after the gap.
    expect(wallClockToInstant('2024-03-10T01:59', 'America/New_York').toISOString()).toBe(
      '2024-03-10T06:59:00.000Z',
    );
    expect(wallClockToInstant('2024-03-10T03:00', 'America/New_York').toISOString()).toBe(
      '2024-03-10T07:00:00.000Z',
    );
    expect(wallClockToInstant('2024-03-10T02:30', 'America/New_York').toISOString()).toBe(
      '2024-03-10T06:30:00.000Z',
    );
  });

  it('rejects input that is not a wall-clock date-time', () => {
    expect(() => meetingTable('2024-03-10', 'UTC', ['UTC'])).toThrow(/ISO format/);
    expect(() => meetingTable('nonsense', 'UTC', ['UTC'])).toThrow(/ISO format/);
  });
});
