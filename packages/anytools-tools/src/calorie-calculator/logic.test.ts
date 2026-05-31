import { describe, expect, it } from 'vitest';
import { ACTIVITY_FACTOR, calcBmr, calculateCalories } from './logic';

describe('calcBmr', () => {
  it('male 70kg 170cm 30yr gives 1617.5 kcal', () => {
    expect(calcBmr(70, 170, 30, 'male')).toBeCloseTo(1617.5);
  });

  it('female 60kg 165cm 25yr gives 1345.25 kcal', () => {
    expect(calcBmr(60, 165, 25, 'female')).toBeCloseTo(1345.25);
  });

  it('clamps to 0 for extreme negative inputs', () => {
    expect(calcBmr(1, 1, 500, 'male')).toBe(0);
  });
});

describe('calculateCalories', () => {
  it('sedentary TDEE = BMR × 1.2', () => {
    const { bmr, tdee } = calculateCalories(70, 170, 30, 'male', 'sedentary');
    expect(tdee).toBeCloseTo(bmr * ACTIVITY_FACTOR.sedentary);
  });

  it('moderate activity TDEE = BMR × 1.55', () => {
    const { bmr, tdee } = calculateCalories(70, 170, 30, 'male', 'moderate');
    expect(tdee).toBeCloseTo(bmr * 1.55);
  });

  it('athlete TDEE = BMR × 1.9', () => {
    const { bmr, tdee } = calculateCalories(70, 170, 30, 'female', 'athlete');
    expect(tdee).toBeCloseTo(bmr * 1.9);
  });

  it('higher activity always yields higher TDEE', () => {
    const { tdee: sedentary } = calculateCalories(70, 170, 30, 'male', 'sedentary');
    const { tdee: athlete } = calculateCalories(70, 170, 30, 'male', 'athlete');
    expect(athlete).toBeGreaterThan(sedentary);
  });

  it('returns bmr matching calcBmr standalone', () => {
    const { bmr } = calculateCalories(80, 180, 35, 'male', 'light');
    expect(bmr).toBeCloseTo(calcBmr(80, 180, 35, 'male'));
  });
});
