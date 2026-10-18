import { describe, expect, it } from 'vitest';
import { mifflinStJeor } from './logic';

describe('mifflinStJeor', () => {
  it('calculates male BMR correctly (reference: 70kg 170cm 30yr)', () => {
    // 10*70 + 6.25*170 - 5*30 + 5 = 700 + 1062.5 - 150 + 5 = 1617.5
    expect(mifflinStJeor(70, 170, 30, 'male')).toBeCloseTo(1617.5);
  });

  it('calculates female BMR correctly (reference: 60kg 165cm 25yr)', () => {
    // 10*60 + 6.25*165 - 5*25 - 161 = 600 + 1031.25 - 125 - 161 = 1345.25
    expect(mifflinStJeor(60, 165, 25, 'female')).toBeCloseTo(1345.25);
  });

  it('male BMR is 166 kcal higher than female for same inputs', () => {
    const male = mifflinStJeor(70, 170, 30, 'male');
    const female = mifflinStJeor(70, 170, 30, 'female');
    expect(male - female).toBeCloseTo(166); // (base+5) - (base-161) = 166
  });

  it('clamps negative result to 0 for extreme inputs', () => {
    // Very low weight, tall but very old → could go negative
    expect(mifflinStJeor(1, 1, 500, 'male')).toBe(0);
  });

  it('increases with higher weight', () => {
    const lighter = mifflinStJeor(60, 170, 30, 'male');
    const heavier = mifflinStJeor(90, 170, 30, 'male');
    expect(heavier).toBeGreaterThan(lighter);
  });
});
