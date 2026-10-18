export type Sex = 'male' | 'female';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'active' | 'athlete';

export const ACTIVITY_FACTOR: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  athlete: 1.9,
};

export const ACTIVITY_LABEL: Record<Activity, string> = {
  sedentary: 'Sedentary (desk job)',
  light: 'Light (1-3×/week)',
  moderate: 'Moderate (3-5×/week)',
  active: 'Active (6-7×/week)',
  athlete: 'Athlete (2× daily)',
};

export type CalorieResult = {
  bmr: number;
  tdee: number;
};

/**
 * Mifflin-St Jeor BMR formula (clamped to 0 minimum).
 */
export function calcBmr(kg: number, cm: number, age: number, sex: Sex): number {
  const base = 10 * kg + 6.25 * cm - 5 * age;
  const raw = sex === 'male' ? base + 5 : base - 161;
  return Math.max(0, raw);
}

/**
 * Calculate BMR and TDEE (Total Daily Energy Expenditure).
 * @param kg - Body weight in kilograms
 * @param cm - Height in centimeters
 * @param age - Age in years
 * @param sex - Biological sex
 * @param activity - Activity level key
 */
export function calculateCalories(
  kg: number,
  cm: number,
  age: number,
  sex: Sex,
  activity: Activity,
): CalorieResult {
  const bmr = calcBmr(kg, cm, age, sex);
  const factor = ACTIVITY_FACTOR[activity];
  const tdee = bmr * factor;
  return { bmr, tdee };
}
