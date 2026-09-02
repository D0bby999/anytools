// Pure math for amortizing loan calculations.

export type LoanResult = {
  /** Fixed monthly payment */
  monthly: number;
  /** Total amount paid over all months */
  total: number;
  /** Total interest paid (total - principal) */
  interest: number;
};

/**
 * Calculate monthly payment and totals for a fully-amortizing loan.
 *
 * Standard amortization formula:
 *   M = P × [r(1+r)^n] / [(1+r)^n − 1]
 *
 * where:
 *   P = principal
 *   r = monthly interest rate (annualRatePct / 100 / 12)
 *   n = total months
 *
 * Special case: r = 0 → M = P / n (simple division, no interest)
 */
export function amortize(principal: number, annualRatePct: number, months: number): LoanResult {
  if (months <= 0) return { monthly: 0, total: 0, interest: 0 };

  const monthlyRate = annualRatePct / 100 / 12;

  if (monthlyRate === 0) {
    const monthly = principal / months;
    return { monthly, total: principal, interest: 0 };
  }

  const factor = (1 + monthlyRate) ** months;
  const monthly = (principal * monthlyRate * factor) / (factor - 1);
  const total = monthly * months;

  return { monthly, total, interest: total - principal };
}
