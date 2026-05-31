export type BmiCategory =
  | 'underweight'
  | 'normal'
  | 'overweight'
  | 'obese-1'
  | 'obese-2'
  | 'obese-3';

export function calculateBmi(weightKg: number, heightCm: number): number {
  if (heightCm <= 0 || weightKg <= 0) return 0;
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

export function categorize(bmi: number): BmiCategory {
  if (bmi < 18.5) return 'underweight';
  if (bmi < 25) return 'normal';
  if (bmi < 30) return 'overweight';
  if (bmi < 35) return 'obese-1';
  if (bmi < 40) return 'obese-2';
  return 'obese-3';
}
