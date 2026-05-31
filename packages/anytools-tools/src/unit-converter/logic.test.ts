import { describe, expect, it } from 'vitest';
import { convert } from './logic';

describe('convert — length', () => {
  it('meters to centimeters', () => {
    expect(convert('length', 'm', 'cm', 1)).toBeCloseTo(100, 5);
  });

  it('kilometers to meters', () => {
    expect(convert('length', 'km', 'm', 1)).toBeCloseTo(1000, 5);
  });

  it('inches to centimeters', () => {
    expect(convert('length', 'in', 'cm', 1)).toBeCloseTo(2.54, 3);
  });

  it('miles to kilometers', () => {
    expect(convert('length', 'mi', 'km', 1)).toBeCloseTo(1.60934, 3);
  });

  it('round-trip: feet → meters → feet', () => {
    const meters = convert('length', 'ft', 'm', 6);
    expect(convert('length', 'm', 'ft', meters)).toBeCloseTo(6, 5);
  });
});

describe('convert — weight', () => {
  it('kilograms to grams', () => {
    expect(convert('weight', 'kg', 'g', 1)).toBeCloseTo(1000, 5);
  });

  it('pounds to kilograms', () => {
    expect(convert('weight', 'lb', 'kg', 1)).toBeCloseTo(0.453592, 4);
  });

  it('ounces to grams', () => {
    expect(convert('weight', 'oz', 'g', 1)).toBeCloseTo(28.3495, 2);
  });
});

describe('convert — temperature', () => {
  it('0°C → 32°F', () => {
    expect(convert('temperature', 'C', 'F', 0)).toBeCloseTo(32, 5);
  });

  it('100°C → 212°F', () => {
    expect(convert('temperature', 'C', 'F', 100)).toBeCloseTo(212, 5);
  });

  it('0°C → 273.15 K', () => {
    expect(convert('temperature', 'C', 'K', 0)).toBeCloseTo(273.15, 4);
  });

  it('32°F → 0°C', () => {
    expect(convert('temperature', 'F', 'C', 32)).toBeCloseTo(0, 5);
  });

  it('212°F → 100°C', () => {
    expect(convert('temperature', 'F', 'C', 212)).toBeCloseTo(100, 5);
  });

  it('round-trip: C → K → C', () => {
    const k = convert('temperature', 'C', 'K', 25);
    expect(convert('temperature', 'K', 'C', k)).toBeCloseTo(25, 5);
  });
});

describe('convert — volume', () => {
  it('1 liter = 1000 mL', () => {
    expect(convert('volume', 'L', 'mL', 1)).toBeCloseTo(1000, 5);
  });

  it('1 US gallon ≈ 3.785 liters', () => {
    expect(convert('volume', 'gal_us', 'L', 1)).toBeCloseTo(3.785, 2);
  });
});

describe('convert — unknown unit returns 0', () => {
  it('returns 0 for unknown fromId', () => {
    expect(convert('length', 'unknown', 'm', 5)).toBe(0);
  });

  it('returns 0 for unknown toId', () => {
    expect(convert('length', 'm', 'unknown', 5)).toBe(0);
  });
});
