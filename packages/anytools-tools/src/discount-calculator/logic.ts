// Pure math for discount and tax calculations.

export type DiscountResult = {
  /** Absolute discount amount removed from original price */
  discount: number;
  /** Price after discount, before tax */
  afterDiscount: number;
  /** Tax amount applied to afterDiscount */
  tax: number;
  /** Final price: afterDiscount + tax */
  final: number;
  /** Amount saved vs. original price (original - final) */
  savings: number;
};

/**
 * Apply a percentage discount and optional tax to an original price.
 *
 * discount      = original × (discountPct / 100)
 * afterDiscount = original − discount
 * tax           = afterDiscount × (taxPct / 100)
 * final         = afterDiscount + tax
 */
export function calcDiscount(original: number, discountPct: number, taxPct = 0): DiscountResult {
  const discount = original * (discountPct / 100);
  const afterDiscount = original - discount;
  const tax = afterDiscount * (taxPct / 100);
  const final = afterDiscount + tax;

  return {
    discount,
    afterDiscount,
    tax,
    final,
    savings: original - final,
  };
}

/**
 * Apply two sequential (stacked) discounts to an original price.
 * Each discount is applied to the result of the previous.
 *
 * e.g., 20% then 10% is NOT 30%; it is original × 0.8 × 0.9 = 72% of original.
 */
export function calcStackedDiscounts(
  original: number,
  firstPct: number,
  secondPct: number,
): DiscountResult {
  const afterFirst = original * (1 - firstPct / 100);
  const finalPrice = afterFirst * (1 - secondPct / 100);

  return {
    discount: original - finalPrice,
    afterDiscount: afterFirst,
    tax: 0,
    final: finalPrice,
    savings: original - finalPrice,
  };
}
