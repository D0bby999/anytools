export type Sex = 'male' | 'female';

export type BodyFatCategory = {
  label: string;
  tone: 'good' | 'warn' | 'danger' | 'neutral';
};

/**
 * US Navy body fat estimation (Hodgdon-Beckett), inputs in centimeters.
 * Returns null when the log10 domain is invalid (waist <= neck, or height <= 0).
 *
 * Formula (circumference method, cm):
 *   male:   495 / (1.0324 - 0.19077 × log10(waist - neck) + 0.15456 × log10(height)) - 450
 *   female: 495 / (1.29579 - 0.35004 × log10(waist + hip - neck) + 0.221 × log10(height)) - 450
 */
export function usNavyBodyFat(
  sex: Sex,
  heightCm: number,
  waistCm: number,
  neckCm: number,
  hipCm: number,
): number | null {
  if (heightCm <= 0) return null;

  if (sex === 'male') {
    if (waistCm - neckCm <= 0) return null;
    return (
      495 / (1.0324 - 0.19077 * Math.log10(waistCm - neckCm) + 0.15456 * Math.log10(heightCm)) -
      450
    );
  }

  if (waistCm + hipCm - neckCm <= 0) return null;
  return (
    495 /
      (1.29579 -
        0.35004 * Math.log10(waistCm + hipCm - neckCm) +
        0.221 * Math.log10(heightCm)) -
    450
  );
}

/**
 * Classify body fat percentage into health category per ACE guidelines.
 */
export function classifyBodyFat(bf: number, sex: Sex): BodyFatCategory {
  if (sex === 'male') {
    if (bf < 6) return { label: 'Essential fat', tone: 'warn' };
    if (bf < 14) return { label: 'Athletic', tone: 'good' };
    if (bf < 18) return { label: 'Fitness', tone: 'good' };
    if (bf < 25) return { label: 'Average', tone: 'neutral' };
    return { label: 'High', tone: 'warn' };
  }
  if (bf < 14) return { label: 'Essential fat', tone: 'warn' };
  if (bf < 21) return { label: 'Athletic', tone: 'good' };
  if (bf < 25) return { label: 'Fitness', tone: 'good' };
  if (bf < 32) return { label: 'Average', tone: 'neutral' };
  return { label: 'High', tone: 'warn' };
}
