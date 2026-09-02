import { describe, expect, it } from 'vitest';
import { evaluateExpression, formatResult } from './logic';

describe('evaluateExpression', () => {
  it('evaluates basic arithmetic', () => {
    expect(evaluateExpression('2 + 3')).toBe(5);
    expect(evaluateExpression('10 - 4')).toBe(6);
    expect(evaluateExpression('3 * 4')).toBe(12);
    expect(evaluateExpression('8 / 2')).toBe(4);
  });

  it('evaluates trig functions (radians)', () => {
    expect(evaluateExpression('sin(0)')).toBeCloseTo(0);
    expect(evaluateExpression('cos(0)')).toBeCloseTo(1);
  });

  it('evaluates sqrt and log', () => {
    expect(evaluateExpression('sqrt(16)')).toBeCloseTo(4);
    expect(evaluateExpression('log(100)')).toBeCloseTo(2);
  });

  it('evaluates pi constant', () => {
    const result = evaluateExpression('pi');
    expect(typeof result).toBe('number');
    expect(result as number).toBeCloseTo(Math.PI);
  });

  it('returns Syntax error for malformed input', () => {
    expect(evaluateExpression('2 +')).toBe('Syntax error');
    expect(evaluateExpression('unknown(1)')).toBe('Syntax error');
  });

  it('returns empty string for blank input', () => {
    expect(evaluateExpression('')).toBe('');
    expect(evaluateExpression('   ')).toBe('');
  });
});

describe('formatResult', () => {
  it('formats integers without decimals', () => {
    expect(formatResult(42)).toBe('42');
  });

  it('formats decimals with trailing zero trimming', () => {
    // 1/3 should produce up to 8 decimals, zeros stripped
    const r = formatResult(1 / 3);
    expect(r).toMatch(/^0\.3+$/);
  });

  it('returns — for empty string', () => {
    expect(formatResult('')).toBe('—');
  });

  it('passes through error strings unchanged', () => {
    expect(formatResult('Syntax error')).toBe('Syntax error');
  });

  it('returns Error for non-finite numbers', () => {
    expect(formatResult(Number.POSITIVE_INFINITY)).toBe('Error');
    expect(formatResult(Number.NaN)).toBe('Error');
  });
});
