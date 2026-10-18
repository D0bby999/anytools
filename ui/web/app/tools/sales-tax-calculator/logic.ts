// Pure math for sales tax calculations (forward and reverse).

export type SalesTaxResult = {
  /** Pre-tax amount */
  pretax: number;
  /** Tax amount */
  tax: number;
  /** Total (pretax + tax) */
  total: number;
};

/**
 * Add sales tax to a pre-tax amount.
 *
 * tax   = pretaxAmount × (ratePct / 100)
 * total = pretaxAmount + tax
 */
export function addTax(pretaxAmount: number, ratePct: number): SalesTaxResult {
  const tax = pretaxAmount * (ratePct / 100);
  return {
    pretax: pretaxAmount,
    tax,
    total: pretaxAmount + tax,
  };
}

/**
 * Remove (back-calculate) sales tax from a tax-inclusive total.
 *
 * pretax = total / (1 + ratePct / 100)
 * tax    = total - pretax
 */
export function removeTax(taxInclusiveTotal: number, ratePct: number): SalesTaxResult {
  const pretax = taxInclusiveTotal / (1 + ratePct / 100);
  const tax = taxInclusiveTotal - pretax;
  return {
    pretax,
    tax,
    total: taxInclusiveTotal,
  };
}

/**
 * Unified entry point: dispatches to addTax or removeTax based on mode.
 */
export function calcSalesTax(
  amount: number,
  ratePct: number,
  mode: 'add' | 'remove',
): SalesTaxResult {
  return mode === 'add' ? addTax(amount, ratePct) : removeTax(amount, ratePct);
}
