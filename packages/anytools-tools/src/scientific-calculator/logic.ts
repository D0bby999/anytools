/**
 * Scientific calculator logic — thin re-export of the expression evaluator
 * plus display formatting helpers. Pure functions, no side effects.
 */
export { evaluateExpression } from './expression-evaluator';

/** Format a numeric result for display: integers shown whole, decimals trimmed. */
export function formatResult(result: number | string): string {
  if (typeof result !== 'number') return result || '—';
  if (!Number.isFinite(result)) return 'Error';
  if (Number.isInteger(result)) return result.toLocaleString();
  return result.toFixed(8).replace(/\.?0+$/, '');
}
