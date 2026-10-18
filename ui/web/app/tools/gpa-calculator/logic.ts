/** Pure GPA calculation logic — US 4.0 scale, weighted by credit hours. */

export const GRADE_POINTS: Record<string, number> = {
  'A+': 4.0,
  A: 4.0,
  'A-': 3.7,
  'B+': 3.3,
  B: 3.0,
  'B-': 2.7,
  'C+': 2.3,
  C: 2.0,
  'C-': 1.7,
  'D+': 1.3,
  D: 1.0,
  F: 0,
};

export const GRADES = Object.keys(GRADE_POINTS);

export type Course = { id: number; name: string; grade: string; credits: number };

export type GpaResult = {
  gpa: number;
  totalCredits: number;
  totalPoints: number;
};

/** Compute weighted GPA from a list of courses. */
export function calculateGpa(courses: Course[]): GpaResult {
  const totalPoints = courses.reduce((s, c) => s + (GRADE_POINTS[c.grade] ?? 0) * c.credits, 0);
  const totalCredits = courses.reduce((s, c) => s + c.credits, 0);
  const gpa = totalCredits > 0 ? totalPoints / totalCredits : 0;
  return { gpa, totalCredits, totalPoints };
}
