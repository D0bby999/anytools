/**
 * ai-evaluation.ts
 * The AI evaluation's pass rates (the private design notes, phase
 * 2), counted the way the API checks them (internal/learning/worksheet/
 * kinds_ai_evaluation.go): an attempt is a case row with a version and a
 * first pass chosen, failures and timeouts included; the first-pass rate
 * counts its passes and the revised rate its accepted final states. Pure, so
 * it is tested without a page.
 */
import type { TableRow } from "~/lib/worksheet-types";

export const AI_EVALUATION_KIND = "ai_evaluation";

/** Where the kind keeps its rows and its stored rates. */
export const CASES_SECTION = "cases";
export const CASES_TABLE = "cases";
export const RESULTS_SECTION = "results";
export const RATES_TABLE = "rates";
export const FIRST_PASS = "first_pass";
export const REVISED = "revised";

export type Rate = { firstPass: number; revised: number; attempts: number };

const text = (row: TableRow, key: string) => {
  const v = row.cells[key];
  return typeof v === "string" ? v.trim() : "";
};

/** Each version's counts from the case rows, saved or not. */
export function ratesOf(rows: TableRow[]): Record<string, Rate> {
  const out: Record<string, Rate> = {};
  for (const row of rows) {
    const version = text(row, "version");
    const outcome = text(row, FIRST_PASS);
    if (!version || !outcome) continue;
    const r = (out[version] ??= { firstPass: 0, revised: 0, attempts: 0 });
    r.attempts++;
    if (outcome === "pass") r.firstPass++;
    if (text(row, "final") === "accepted") r.revised++;
  }
  return out;
}

const rateShape = /^(\d{1,4})\s*\/\s*(\d{1,4})$/;

/** Whether a stored rate cell agrees with the count: an empty cell always does. */
export function agrees(stored: unknown, accepted: number, attempts: number): boolean {
  const v = typeof stored === "string" ? stored.trim() : "";
  if (!v) return true;
  const m = rateShape.exec(v);
  return !!m && Number(m[1]) === accepted && Number(m[2]) === attempts;
}
