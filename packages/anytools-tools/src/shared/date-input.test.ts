import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDateInput, todayInputValue } from './date-input';

describe('parseDateInput', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(['UTC', 'Asia/Ho_Chi_Minh', 'America/Los_Angeles'])(
    'reads the calendar day the user typed, on a machine in %s',
    (tz) => {
      vi.stubEnv('TZ', tz);
      const d = parseDateInput('2024-05-01') as Date;
      expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2024, 5, 1]);
      expect(d.getHours()).toBe(0);
    },
  );

  it('refuses malformed and impossible dates instead of rolling them over', () => {
    expect(parseDateInput('')).toBeNull();
    expect(parseDateInput('2024-5-1')).toBeNull();
    expect(parseDateInput('2024-02-30')).toBeNull();
    expect(parseDateInput('2023-02-29')).toBeNull();
    expect(parseDateInput('2024-02-29')).not.toBeNull();
  });
});

describe('todayInputValue', () => {
  it('formats the local date, zero-padded', () => {
    expect(todayInputValue(new Date(2024, 0, 5, 23, 30))).toBe('2024-01-05');
  });
});
