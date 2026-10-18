import { describe, expect, it } from 'vitest';
import { addDays, calculatePregnancy, fmtDate } from './logic';

describe('addDays', () => {
  it('adds 280 days correctly (Naegele offset)', () => {
    const lmp = new Date('2025-01-01');
    const due = addDays(lmp, 280);
    // 2025-01-01 + 280 days = 2025-10-08
    expect(due.toISOString().slice(0, 10)).toBe('2025-10-08');
  });

  it('does not mutate the original date', () => {
    const d = new Date('2025-06-01');
    addDays(d, 10);
    expect(d.toISOString().slice(0, 10)).toBe('2025-06-01');
  });
});

describe('calculatePregnancy', () => {
  it('due date is LMP + 280 days', () => {
    const lmp = new Date('2025-01-01');
    const now = new Date('2025-01-15'); // 14 days after LMP
    const result = calculatePregnancy(lmp, now);
    expect(result).not.toBeNull();
    expect(result!.dueDate.toISOString().slice(0, 10)).toBe('2025-10-08');
  });

  it('calculates gestational weeks and days at 14 days elapsed', () => {
    const lmp = new Date('2025-01-01');
    const now = new Date('2025-01-15');
    const result = calculatePregnancy(lmp, now);
    expect(result!.weeks).toBe(2);
    expect(result!.days).toBe(0);
  });

  it('assigns trimester 1 for weeks 0-12', () => {
    const lmp = new Date('2025-01-01');
    const now = new Date('2025-03-01'); // ~59 days = 8 weeks
    const result = calculatePregnancy(lmp, now);
    expect(result!.trimester).toBe(1);
  });

  it('assigns trimester 3 for weeks >= 27', () => {
    const lmp = new Date('2024-01-01');
    const now = new Date('2024-08-01'); // ~213 days = 30 weeks
    const result = calculatePregnancy(lmp, now);
    expect(result!.trimester).toBe(3);
  });

  it('returns null for invalid date', () => {
    expect(calculatePregnancy(new Date('not-a-date'))).toBeNull();
  });

  it('remainingDays is 0 when past due date', () => {
    const lmp = new Date('2020-01-01');
    const now = new Date('2025-01-01'); // far in future past due
    const result = calculatePregnancy(lmp, now);
    expect(result!.remainingDays).toBe(0);
  });
});

describe('fmtDate', () => {
  it('returns a non-empty string for a valid date', () => {
    const d = new Date('2025-10-08');
    expect(fmtDate(d)).toBeTruthy();
    expect(typeof fmtDate(d)).toBe('string');
  });
});
