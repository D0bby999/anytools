// Pure math for currency conversion — no network calls, no React.

/**
 * Convert an amount from one currency to another using a pre-fetched rate map.
 *
 * @param amount   - The numeric amount in the source currency
 * @param from     - Source currency code (e.g. "USD")
 * @param to       - Target currency code (e.g. "EUR")
 * @param rates    - Map of currency code → rate relative to the base currency
 * @param base     - The base currency the rates are denominated in (e.g. "USD")
 * @returns        - Converted amount, or null if the rate is unavailable
 */
export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>,
  base: string,
): number | null {
  // Same currency — no conversion needed
  if (from === to) return amount;

  // Direct rate when `from` matches the base
  if (from === base) {
    const rate = rates[to];
    return rate !== undefined ? amount * rate : null;
  }

  // Cross rate: amount → base → target
  const rateFrom = rates[from];
  const rateTo = rates[to];
  if (rateFrom === undefined || rateTo === undefined) return null;

  // amount in base = amount / rateFrom; then × rateTo
  return (amount / rateFrom) * rateTo;
}

/**
 * Extract the rate for one specific target currency.
 * Returns 1 if from === to, null if the rate is missing.
 */
export function extractRate(
  from: string,
  to: string,
  rates: Record<string, number>,
  base: string,
): number | null {
  if (from === to) return 1;
  if (from === base) return rates[to] ?? null;

  const rateFrom = rates[from];
  const rateTo = rates[to];
  if (rateFrom === undefined || rateTo === undefined) return null;
  return rateTo / rateFrom;
}
