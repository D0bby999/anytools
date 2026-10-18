/** Pure grade calculation logic — final exam score needed to reach a target grade. */

export type NeededScoreResult = {
  /** Score needed on the final exam (may be outside 0–100). */
  needed: number;
  /** Whether the target is achievable (0 ≤ needed ≤ 100). */
  achievable: boolean;
};

/**
 * Calculate what score is needed on the final exam to hit a target overall grade.
 *
 * Formula: target = current × (1 − w) + finalScore × w
 *   → finalScore = (target − current × (1 − w)) / w
 *
 * @param current     Current grade (0–100)
 * @param target      Target overall grade (0–100)
 * @param finalWeight Final exam weight as a percentage (0–100)
 */
export function calcNeededScore(
  current: number,
  target: number,
  finalWeight: number,
): NeededScoreResult {
  const w = finalWeight / 100;
  if (w === 0) {
    // Final has no weight; target is already determined by current grade
    return { needed: 0, achievable: current >= target };
  }
  const needed = (target - current * (1 - w)) / w;
  const achievable = needed <= 100 && needed >= 0;
  return { needed, achievable };
}

/** Convert a numeric grade (0–100) to a letter grade using standard cutoffs. */
export function toLetterGrade(percent: number): string {
  if (percent >= 90) return 'A';
  if (percent >= 80) return 'B';
  if (percent >= 70) return 'C';
  if (percent >= 60) return 'D';
  return 'F';
}
