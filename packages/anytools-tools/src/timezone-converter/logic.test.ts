import { describe, expect, it } from 'vitest';
import { formatAtZone, meetingTable, offsetLabel } from './logic';

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
