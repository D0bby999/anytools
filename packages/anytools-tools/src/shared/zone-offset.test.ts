import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatInZone, offsetLabel, zoneOffsetMs } from './zone-offset';

const HOUR = 3_600_000;

describe('zoneOffsetMs', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(['UTC', 'Asia/Ho_Chi_Minh', 'America/Los_Angeles'])(
    'is the same on a machine in %s',
    (machine) => {
      vi.stubEnv('TZ', machine);
      expect(zoneOffsetMs('Asia/Ho_Chi_Minh', new Date('2024-03-10T02:00:00Z'))).toBe(7 * HOUR);
      expect(zoneOffsetMs('UTC', new Date('2024-03-10T02:00:00Z'))).toBe(0);
      // New York on the US spring-forward day: EST before 07:00Z, EDT after.
      expect(zoneOffsetMs('America/New_York', new Date('2024-03-10T06:59:00Z'))).toBe(-5 * HOUR);
      expect(zoneOffsetMs('America/New_York', new Date('2024-03-10T07:00:00Z'))).toBe(-4 * HOUR);
      // Half-hour and 45-minute zones.
      expect(zoneOffsetMs('Asia/Kolkata', new Date('2024-03-10T02:00:00Z'))).toBe(5.5 * HOUR);
      expect(zoneOffsetMs('Asia/Kathmandu', new Date('2024-03-10T02:00:00Z'))).toBe(5.75 * HOUR);
    },
  );
});

describe('formatInZone', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(['UTC', 'America/Los_Angeles'])('formats the same on a machine in %s', (machine) => {
    vi.stubEnv('TZ', machine);
    const t = new Date('2024-03-10T02:05:09Z');
    expect(formatInZone(t, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss xxx')).toBe(
      '2024-03-10 09:05:09 +07:00',
    );
    expect(formatInZone(t, 'UTC', 'HH:mm xxx')).toBe('02:05 +00:00');
    expect(formatInZone(new Date('2024-03-10T07:00:00Z'), 'America/New_York', 'HH:mm xxx')).toBe(
      '03:00 -04:00',
    );
    expect(offsetLabel('Asia/Kathmandu', t)).toBe('+05:45');
    expect(offsetLabel('America/Sao_Paulo', t)).toBe('-03:00');
  });
});
