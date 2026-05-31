// Pure math for retirement savings projections.

export type RetirementResult = {
  /** Number of years until retirement */
  years: number;
  /** Projected total balance at retirement */
  balance: number;
  /** Total amount personally contributed (savings + all monthly deposits) */
  totalContributed: number;
  /** balance - totalContributed */
  interest: number;
  /** Annual safe-withdrawal amount at 4% rule */
  safe4pct: number;
};

/**
 * Project retirement balance using future-value of lump sum + ordinary annuity.
 *
 * FV_savings      = S × (1 + r)^n
 * FV_contributions = PMT × [((1+r)^n − 1) / r]   (r > 0)
 * FV_contributions = PMT × n                       (r = 0)
 *
 * where r = annualRatePct / 100 / 12, n = years × 12
 *
 * The 4% safe-withdrawal rule: safe annual income = balance × 0.04
 */
export function calcRetirement(
  currentSavings: number,
  monthlyContribution: number,
  currentAge: number,
  retireAge: number,
  annualRatePct: number,
): RetirementResult {
  const years = Math.max(0, retireAge - currentAge);
  const months = years * 12;
  const monthlyRate = annualRatePct / 100 / 12;

  const fvSavings = currentSavings * (1 + monthlyRate) ** months;
  const fvContrib =
    monthlyRate === 0
      ? monthlyContribution * months
      : monthlyContribution * (((1 + monthlyRate) ** months - 1) / monthlyRate);

  const balance = fvSavings + fvContrib;
  const totalContributed = currentSavings + monthlyContribution * months;

  return {
    years,
    balance,
    totalContributed,
    interest: balance - totalContributed,
    safe4pct: balance * 0.04,
  };
}
