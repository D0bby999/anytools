export type TipWageResult = {
  netTips: number;
  tipHourly: number;
  effective: number;
  shiftEarnings: number;
};

/**
 * Calculate effective hourly wage for tipped workers.
 * @param tips - Gross tips earned this shift
 * @param baseRate - Base hourly wage
 * @param hours - Hours worked (0 guard returns 0 tip-hourly)
 * @param tipShareOutPct - Percentage tipped out to others (0-100)
 */
export function calculateTipWage(
  tips: number,
  baseRate: number,
  hours: number,
  tipShareOutPct: number,
): TipWageResult {
  const netTips = tips * (1 - tipShareOutPct / 100);
  const tipHourly = hours > 0 ? netTips / hours : 0;
  const effective = baseRate + tipHourly;
  const shiftEarnings = baseRate * hours + netTips;
  return { netTips, tipHourly, effective, shiftEarnings };
}
