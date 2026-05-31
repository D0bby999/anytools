import { describe, expect, it } from 'vitest';
import { parseCron, validateCron } from './logic';

describe('parseCron', () => {
  it('daily at midnight', () => {
    const out = parseCron('0 0 * * *', 3);
    expect(out.description.toLowerCase()).toMatch(/12:00 am|00:00/);
    expect(out.nextRuns).toHaveLength(3);
  });
  it('every 5 minutes', () => {
    const out = parseCron('*/5 * * * *', 2);
    expect(out.description.toLowerCase()).toContain('5 minutes');
    const diff = (out.nextRuns[1]!.getTime() - out.nextRuns[0]!.getTime()) / 1000 / 60;
    expect(diff).toBe(5);
  });
});

describe('validateCron', () => {
  it('accepts valid', () => {
    expect(validateCron('0 9 * * 1-5').valid).toBe(true);
  });
  it('rejects invalid', () => {
    expect(validateCron('60 * * * *').valid).toBe(false);
  });
});
