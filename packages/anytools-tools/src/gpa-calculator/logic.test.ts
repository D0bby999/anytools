import { describe, expect, it } from 'vitest';
import { calculateGpa, GRADE_POINTS } from './logic';
import type { Course } from './logic';

const course = (id: number, grade: string, credits: number): Course => ({
  id,
  name: '',
  grade,
  credits,
});

describe('calculateGpa', () => {
  it('returns 0 GPA and 0 credits for empty course list', () => {
    const result = calculateGpa([]);
    expect(result.gpa).toBe(0);
    expect(result.totalCredits).toBe(0);
    expect(result.totalPoints).toBe(0);
  });

  it('computes GPA for a single A course', () => {
    const result = calculateGpa([course(1, 'A', 3)]);
    expect(result.gpa).toBeCloseTo(4.0);
    expect(result.totalCredits).toBe(3);
    expect(result.totalPoints).toBe(12);
  });

  it('weights by credit hours correctly', () => {
    // A (4.0) × 3 credits + C (2.0) × 1 credit = 14 points / 4 credits = 3.5
    const result = calculateGpa([course(1, 'A', 3), course(2, 'C', 1)]);
    expect(result.gpa).toBeCloseTo(3.5);
    expect(result.totalCredits).toBe(4);
    expect(result.totalPoints).toBe(14);
  });

  it('handles F grade (0 points)', () => {
    const result = calculateGpa([course(1, 'F', 3), course(2, 'A', 3)]);
    // (0*3 + 4.0*3) / 6 = 2.0
    expect(result.gpa).toBeCloseTo(2.0);
  });

  it('handles A+ and A- grades at correct point values', () => {
    expect(GRADE_POINTS['A+']).toBe(4.0);
    expect(GRADE_POINTS['A-']).toBe(3.7);
    const result = calculateGpa([course(1, 'A+', 3), course(2, 'A-', 3)]);
    // (4.0 + 3.7) / 2 = 3.85
    expect(result.gpa).toBeCloseTo(3.85);
  });

  it('treats unknown grade as 0 points', () => {
    const result = calculateGpa([course(1, 'Z', 3)]);
    expect(result.gpa).toBe(0);
    expect(result.totalPoints).toBe(0);
  });
});
