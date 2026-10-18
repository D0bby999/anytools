export type TipResult = {
  tip: number;
  total: number;
  perPerson: number;
};

/**
 * Calculate tip, total, and per-person split.
 * @param bill - Bill amount before tip
 * @param tipPct - Tip percentage (0-100)
 * @param people - Number of people splitting (clamped to minimum 1)
 */
export function calculateTip(bill: number, tipPct: number, people: number): TipResult {
  const tip = bill * (tipPct / 100);
  const total = bill + tip;
  const perPerson = total / Math.max(people, 1);
  return { tip, total, perPerson };
}
