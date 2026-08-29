import { describe, expect, it } from 'vitest';
import { EVERY, PRESETS, buildExpression, describeExpression } from './logic';

describe('buildExpression', () => {
  it('joins the five fields', () => {
    expect(buildExpression({ ...EVERY, minute: '0', hour: '9' })).toBe('0 9 * * *');
  });
  it('defaults empty fields to *', () => {
    expect(
      buildExpression({ minute: ' ', hour: '', dayOfMonth: '1', month: '*', dayOfWeek: '' }),
    ).toBe('* * 1 * *');
  });
});

describe('describeExpression', () => {
  it('describes a valid expression and lists next runs', () => {
    const result = describeExpression({ ...EVERY, minute: '0', hour: '9', dayOfWeek: '1-5' });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.expression).toBe('0 9 * * 1-5');
      expect(result.description.toLowerCase()).toContain('09:00');
      expect(result.nextRuns).toHaveLength(5);
      // Every next run must be a weekday at 09:00 UTC.
      for (const run of result.nextRuns) {
        expect(run.getUTCHours()).toBe(9);
        expect([1, 2, 3, 4, 5]).toContain(run.getUTCDay());
      }
    }
  });

  it('flags invalid fields', () => {
    const result = describeExpression({ ...EVERY, minute: '61' });
    expect(result.valid).toBe(false);
  });
});

describe('PRESETS', () => {
  it('all presets are valid cron expressions', () => {
    for (const preset of PRESETS) {
      expect(describeExpression(preset.fields).valid, preset.id).toBe(true);
    }
  });
});
