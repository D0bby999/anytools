// Pure math for compound interest with monthly contributions.
// Compounding period: monthly. Contributions deposited end-of-month (ordinary annuity).

export type CompoundInterestResult = {
  /** Final account balance after all contributions and interest */
  balance: number;
  /** Sum of initial principal + all periodic contributions */
  totalContributed: number;
  /** balance - totalContributed */
  interest: number;
};

/**
 * Compute future value of a lump-sum principal plus regular monthly contributions.
 *
 * Formula:
 *   FV_principal = P × (1 + r)^n
 *   FV_contributions = PMT × [((1+r)^n − 1) / r]   (r > 0)
 *   FV_contributions = PMT × n                       (r = 0)
 *
 * where r = annualRatePct / 100 / 12, n = years × 12
 */
export function calcCompoundInterest(
  principal: number,
  monthlyContribution: number,
  annualRatePct: number,
  years: number,
): CompoundInterestResult {
  const months = years * 12;
  const monthlyRate = annualRatePct / 100 / 12;

  const fvPrincipal = principal * (1 + monthlyRate) ** months;
  const fvContrib =
    monthlyRate === 0
      ? monthlyContribution * months
      : monthlyContribution * (((1 + monthlyRate) ** months - 1) / monthlyRate);

  const balance = fvPrincipal + fvContrib;
  const totalContributed = principal + monthlyContribution * months;

  return {
    balance,
    totalContributed,
    interest: balance - totalContributed,
  };
}
