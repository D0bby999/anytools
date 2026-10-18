// Reference-value cross-check, batch A's part (AnyTools phase 3a).
//
// The old repo kept these in one src/reference-values.test.ts across every tool. Each tool batch
// ports the cases for its own tools, so the three batches never edit one file; the cases below
// are the old file's, unchanged, for converters, lifestyle, health and finance.
//
// The per-tool logic.test.ts files were written alongside their implementations, so a
// shared misunderstanding would pass both. These values were instead derived
// independently from the published formulas and then compared against the shipped code,
// and each one is a claim the user-facing FAQ copy makes out loud. If a number here
// changes, either the implementation moved or the documentation is now lying.
import { describe, expect, it } from 'vitest';
import { calculateBmi, categorize } from './bmi-calculator/logic';
import { mifflinStJeor } from './bmr-calculator/logic';
import { usNavyBodyFat } from './body-fat-calculator/logic';
import { calculateCalories } from './calorie-calculator/logic';
import { calcCompoundInterest } from './compound-interest/logic';
import { calcStackedDiscounts } from './discount-calculator/logic';
import { calculateSubnet } from './ip-subnet-calculator/logic';
import { amortize as loanAmortize } from './loan-calculator/logic';
import { amortize as mortgageAmortize } from './mortgage-calculator/logic';
import { calculatePace } from './pace-calculator/logic';
import { calculatePregnancy } from './pregnancy-due-date/logic';
import { calcSalesTax } from './sales-tax-calculator/logic';
import { solveSSS } from './triangle-calculator/logic';

const near = (a: number, b: number, eps = 0.01) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('cross-check against independently computed values', () => {
  it('mortgage 320000 @6.5% 30y = 2022.62/mo', () =>
    near(mortgageAmortize(320000, 6.5, 30).monthly, 2022.62));

  it('loan 25000 @7.5% 60mo = 500.95/mo', () => near(loanAmortize(25000, 7.5, 60).monthly, 500.95));

  it('compound 10000 + 500/mo @7% 10y = 106639.02', () =>
    near(calcCompoundInterest(10000, 500, 7, 10).balance, 106639.02, 0.5));

  it('BMI 70kg/175cm = 22.857 and is normal', () => {
    near(calculateBmi(70, 175), 22.8571);
    expect(categorize(calculateBmi(70, 175))).toBe('normal');
  });

  it('BMR male 80/180/30 = 1780', () => near(mifflinStJeor(80, 180, 30, 'male'), 1780));

  it('BMR female 60/165/30 = 1320.25', () => near(mifflinStJeor(60, 165, 30, 'female'), 1320.25));

  it('body fat male h180 w90 n38 = 19.812', () =>
    near(usNavyBodyFat('male', 180, 90, 38, 0) as number, 19.812));

  it('TDEE = BMR x 1.55 at moderate', () =>
    near(calculateCalories(80, 180, 30, 'male', 'moderate').tdee, 1780 * 1.55, 0.1));

  it('triangle 3,4,5 -> area 6, right angle at C', () => {
    // biome-ignore lint/style/noNonNullAssertion: 3-4-5 is a valid triangle
    const t = solveSSS(3, 4, 5)!;
    near(t.area, 6);
    near(t.angleC, 90);
    expect(t.isRight).toBe(true);
  });

  it('triangle 1,2,5 violates the inequality and is refused', () =>
    expect(solveSSS(1, 2, 5)).toBeNull());

  it('remove 10% tax from 110 -> pretax 100', () =>
    near(calcSalesTax(110, 10, 'remove').pretax, 100));

  it('stacked 20% then 10% off 100 = 72, not 70', () => {
    const r = calcStackedDiscounts(100, 20, 10);
    near(r.final, 72);
    // The intermediate step is the reason the two discounts do not add to 30%.
    near(r.afterDiscount, 80);
    near(r.discount, 28);
  });

  it('pace 10km in 50min = 5:00/km', () => near(calculatePace(10, 3000).paceSecPerKm, 300));
});

describe('numeric claims made in the FAQ copy', () => {
  it('pregnancy: trimester 1 = weeks 0-12, 2 = 13-26, 3 = 27+', () => {
    const lmp = new Date('2026-01-01T00:00:00Z');
    const at = (weeks: number) =>
      calculatePregnancy(lmp, new Date(lmp.getTime() + weeks * 7 * 86400000))?.trimester;
    expect(at(12)).toBe(1);
    expect(at(13)).toBe(2);
    expect(at(26)).toBe(2);
    expect(at(27)).toBe(3);
  });

  it('pregnancy: due date is LMP + 280 days', () => {
    const lmp = new Date('2026-01-01T00:00:00Z');
    const r = calculatePregnancy(lmp, lmp);
    const days = Math.round((r!.dueDate.getTime() - lmp.getTime()) / 86400000);
    expect(days).toBe(280);
  });

  it('subnet: /24 = 254 usable, /31 and /32 are not reduced by two', () => {
    const a = calculateSubnet('192.168.1.0', 24);
    const b = calculateSubnet('192.168.1.0', 31);
    const c = calculateSubnet('192.168.1.1', 32);
    console.log(`/24=${a?.hostCount} /31=${b?.hostCount} /32=${c?.hostCount}`);
    expect(a?.hostCount).toBe(254);
    expect(b?.hostCount).toBe(2);
    expect(c?.hostCount).toBe(1);
    expect(a?.broadcastAddress).toBe('192.168.1.255');
  });
});
