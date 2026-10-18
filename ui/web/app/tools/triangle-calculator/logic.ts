export type TriangleResult = {
  area: number;
  perimeter: number;
  angleA: number;
  angleB: number;
  angleC: number;
  isRight: boolean;
  classification: 'equilateral' | 'isosceles' | 'scalene';
};

/**
 * Solves a triangle given three sides (SSS) using Heron's formula for area
 * and the law of cosines for angles.
 * Returns null if the inputs violate the triangle inequality.
 */
export function solveSSS(a: number, b: number, c: number): TriangleResult | null {
  if (a <= 0 || b <= 0 || c <= 0) return null;
  if (a + b <= c || a + c <= b || b + c <= a) return null;

  const s = (a + b + c) / 2;
  const area = Math.sqrt(s * (s - a) * (s - b) * (s - c));
  const angleA = (Math.acos((b * b + c * c - a * a) / (2 * b * c)) * 180) / Math.PI;
  const angleB = (Math.acos((a * a + c * c - b * b) / (2 * a * c)) * 180) / Math.PI;
  const angleC = 180 - angleA - angleB;
  const perimeter = a + b + c;
  const isRight =
    Math.abs(angleA - 90) < 0.01 || Math.abs(angleB - 90) < 0.01 || Math.abs(angleC - 90) < 0.01;

  let classification: TriangleResult['classification'];
  if (a === b && b === c) classification = 'equilateral';
  else if (a === b || b === c || a === c) classification = 'isosceles';
  else classification = 'scalene';

  return { area, perimeter, angleA, angleB, angleC, isRight, classification };
}
