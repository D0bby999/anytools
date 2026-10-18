export type Sex = 'male' | 'female';

/**
 * Mifflin-St Jeor BMR formula.
 * @param kg - Body weight in kilograms
 * @param cm - Height in centimeters
 * @param age - Age in years
 * @param sex - Biological sex
 * @returns BMR in kcal/day (clamped to 0 minimum)
 */
export function mifflinStJeor(kg: number, cm: number, age: number, sex: Sex): number {
  const base = 10 * kg + 6.25 * cm - 5 * age;
  const raw = sex === 'male' ? base + 5 : base - 161;
  return Math.max(0, raw);
}
