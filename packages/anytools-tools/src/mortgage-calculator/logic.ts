// Pure math for mortgage amortization calculations.

export type MortgageResult = {
  /** Fixed monthly payment (principal + interest only; no PMI/taxes) */
  monthly: number;
  /** Total amount paid over the loan term */
  totalPaid: number;
  /** Total interest paid (totalPaid - principal) */
  totalInterest: number;
};

/**
 * Calculate monthly mortgage payment and totals for a fixed-rate loan.
 *
 * Standard amortization formula:
 *   M = P × [r(1+r)^n] / [(1+r)^n − 1]
 *
 * where:
 *   P = principal (home price - down payment)
 *   r = monthly interest rate (annualRatePct / 100 / 12)
 *   n = years × 12
 *
 * Special case: r = 0 → M = P / n (interest-free loan)
 *
 * Verified: amortize(320000, 6.5, 30) → monthly ≈ 2022.62
 */
export function amortize(principal: number, annualRatePct: number, years: number): MortgageResult {
  const months = years * 12;

  if (months <= 0) return { monthly: 0, totalPaid: 0, totalInterest: 0 };

  const monthlyRate = annualRatePct / 100 / 12;

  if (monthlyRate === 0) {
    const monthly = principal / months;
    return { monthly, totalPaid: principal, totalInterest: 0 };
  }

  const factor = (1 + monthlyRate) ** months;
  const monthly = (principal * monthlyRate * factor) / (factor - 1);
  const totalPaid = monthly * months;

  return { monthly, totalPaid, totalInterest: totalPaid - principal };
}
