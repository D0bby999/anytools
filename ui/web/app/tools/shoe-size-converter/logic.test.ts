import { describe, expect, it } from 'vitest';
import { MEN, WOMEN, findClosest } from './logic';

describe('findClosest — men', () => {
  it('finds exact US match', () => {
    const r = findClosest('men', 'us', 10);
    expect(r.us).toBe(10);
    expect(r.eu).toBe(43);
    expect(r.uk).toBe(9.5);
    expect(r.cm).toBe(26.7);
  });

  it('finds exact EU match', () => {
    const r = findClosest('men', 'eu', 42);
    expect(r.us).toBe(9);
  });

  it('finds closest for non-exact value (US 9.7 → US 10)', () => {
    const r = findClosest('men', 'us', 9.7);
    expect(r.us).toBe(10);
  });

  it('finds closest for non-exact value (US 8.4 → US 8)', () => {
    const r = findClosest('men', 'us', 8.4);
    expect(r.us).toBe(8);
  });
});

describe('findClosest — women', () => {
  it('finds exact US match', () => {
    const r = findClosest('women', 'us', 8);
    expect(r.eu).toBe(38);
    expect(r.cm).toBe(23.8);
  });

  it('finds closest UK match', () => {
    const r = findClosest('women', 'uk', 4.5);
    expect(r.us).toBe(7);
    expect(r.eu).toBe(37);
  });

  it('finds closest cm match', () => {
    const r = findClosest('women', 'cm', 24.5);
    expect(r.us).toBe(9);
  });
});

describe('data tables', () => {
  it('MEN table has 8 entries', () => {
    expect(MEN).toHaveLength(8);
  });

  it('WOMEN table has 7 entries', () => {
    expect(WOMEN).toHaveLength(7);
  });

  it('MEN US sizes are strictly increasing', () => {
    for (let i = 1; i < MEN.length; i++) {
      expect(MEN[i]!.us).toBeGreaterThan(MEN[i - 1]!.us);
    }
  });
});
