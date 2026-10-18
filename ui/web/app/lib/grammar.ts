/**
 * grammar.ts
 * What the page adds to the grammar error map (up methods, phase 6) beyond
 * the served kind: its rows sorted by priority, and "Start a contrast card",
 * which opens a grammar evidence worksheet prefilled from one row. Pure, so
 * it is tested without a page.
 *
 * Priority is the label column the kind derives from the row's impact
 * (`text_from`); the chapter lists the impacts in priority order, so a
 * priority ranks where its first impact stands in that list.
 */
import type { Answers, TableRow, WorksheetField, WorksheetKind } from "~/lib/worksheet-types";
import { labelText } from "~/lib/worksheet-values";

export const GRAMMAR_MAP_KIND = "grammar_error_map";
export const GRAMMAR_EVIDENCE_KIND = "grammar_evidence";

/** Where the map's own rows are (internal/learning/worksheet/kinds_grammar.go). */
export const MAP_SECTION = "map";
export const MAP_ERRORS = "errors";

/** The order the error rows are shown in: highest priority first, rows without an impact last, ties as saved. */
export function priorityOrder(table: WorksheetField, rows: TableRow[]): number[] {
  const priority = table.columns?.find((c) => c.type === "label" && c.text_from);
  const indexes = rows.map((_, i) => i);
  if (!priority?.text_from) return indexes;
  const options = table.columns?.find((c) => c.key === priority.text_from)?.options ?? [];
  const ranks = options.map((o) => priority.text?.[o] ?? "");
  const rank = (row: TableRow) => {
    const label = labelText(priority, row);
    const at = label ? ranks.indexOf(label) : -1;
    return at < 0 ? ranks.length : at;
  };
  return indexes.sort((a, b) => rank(rows[a]!) - rank(rows[b]!) || a - b);
}

/** One error row, as "Start a contrast card" carries it. */
export type ErrorRow = { sample: string; meant: string; decision: string; impact: string };

export function errorRow(row: TableRow): ErrorRow {
  const s = (key: string) => {
    const v = row.cells[key];
    return typeof v === "string" ? v.trim() : "";
  };
  return { sample: s("sample"), meant: s("meant"), decision: s("decision"), impact: s("impact") };
}

/** The title a contrast card started from a row gets, and is found again by. */
export function contrastCardTitle(card: WorksheetKind, sample: string): string {
  return `${card.name}: ${sample}`.slice(0, 200);
}

const optionOf = (field: WorksheetField | undefined, v: string) => (v && field?.options?.includes(v) ? v : "");

/**
 * The grammar evidence answers a row prefills: §2's original sentence and
 * impact, the Original sample's meaning decision, and §3's "Meaning I need to
 * express" from what the learner meant. A value the card's lists do not hold
 * is left out, so the write is never refused.
 */
export function contrastCardAnswers(card: WorksheetKind, row: ErrorRow): Answers {
  const problem = card.sections.find((s) => s.key === "problem");
  const field = (key: string) => problem?.fields.find((f) => f.key === key);
  const choice = field("samples")?.columns?.find((c) => c.key === "choice");
  const answers: Answers = {};
  const p: Answers[string] = {};
  if (row.sample) p.original = row.sample;
  const impact = optionOf(field("impact"), row.impact);
  if (impact) p.impact = impact;
  const decision = optionOf(choice, row.decision);
  if (decision) p.samples = [{ row: "original", cells: { choice: decision } }];
  if (Object.keys(p).length > 0) answers.problem = p;
  if (row.meant) answers.contrast = { meaning: row.meant.slice(0, 500) };
  return answers;
}
