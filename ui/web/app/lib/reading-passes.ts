/**
 * reading-passes.ts
 * The parts of the reading evidence kind the reader itself acts on (up-methods
 * phase 5). The kind is served like every other (GET /v1/worksheet-kinds);
 * these are only the keys the page needs to find its passes and its barrier
 * map, as named in internal/learning/worksheet/kinds_reading_evidence.go.
 * Pure, so it is tested without a page.
 */
import type { TableRow, WorksheetDetail, WorksheetField, WorksheetKind } from "~/lib/worksheet-types";

export const READING_KIND = "reading_evidence";
export const PASSES = { section: "passes", field: "passes" } as const;
export const BARRIERS = { section: "barriers", field: "map" } as const;
/** Pass 4: rebuild with the text and the dictionary closed. */
export const REBUILD = "rebuild";

/** A one-line text cell's limit (worksheet.MaxText). */
const MAX_TEXT = 500;

function tableField(kind: WorksheetKind | undefined, at: { section: string; field: string }): WorksheetField | undefined {
  return kind?.sections.find((s) => s.key === at.section)?.fields.find((f) => f.key === at.field && f.type === "table");
}

export const passesField = (kind?: WorksheetKind) => tableField(kind, PASSES);
export const barriersField = (kind?: WorksheetKind) => tableField(kind, BARRIERS);

/** A table's stored rows. */
export function storedRows(sheet: WorksheetDetail | null, at: { section: string; field: string }): TableRow[] {
  const v = sheet?.worksheet.answers[at.section]?.[at.field];
  return Array.isArray(v) ? (v as TableRow[]) : [];
}

/** The first pass not marked done, or null once all five are. */
export function currentPass(field: WorksheetField | undefined, rows: TableRow[]) {
  const fixed = field?.rows ?? [];
  const index = fixed.findIndex((r) => rows.find((x) => x.row === r.key)?.cells.done !== true);
  const row = fixed[index];
  return row ? { index, row, total: fixed.length } : null;
}

/** Whether the page closes the text and the tutor: the current pass is pass 4. */
export function closedForRebuild(sheet: WorksheetDetail | null): boolean {
  if (!sheet || sheet.worksheet.status !== "open") return false;
  return currentPass(passesField(sheet.kind), storedRows(sheet, PASSES))?.row.key === REBUILD;
}

/** The selection as "where I got stuck": one line, within the cell's limit. */
export function clipLine(text: string, max = MAX_TEXT): string {
  const line = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(line);
  return chars.length <= max ? line : `${chars.slice(0, max - 1).join("")}…`;
}

/** A §4 row prefilled from the reader: the page, and the selected text. */
export function barrierRow(selection: string, page: number): TableRow {
  const cells: TableRow["cells"] = { stuck: clipLine(selection) };
  if (page > 0) cells.page = String(page);
  return { row: "", cells };
}

/** The vocabulary barrier layer (LayerVocabulary in kinds_reading_evidence.go). */
export const VOCABULARY_LAYER = "vocabulary and grammar";

/**
 * What a §4 row gives the word picker (phase 5, requirement 3): its passage
 * and page, when the row is on the vocabulary layer. The page cell is free
 * text; only a plain page number names a page the server can check the
 * passage against, so any other row offers no picker.
 */
export function barrierWord(row: TableRow): { selection: string; page: number } | null {
  const { layer, page, stuck } = row.cells;
  if (layer !== VOCABULARY_LAYER || typeof stuck !== "string" || stuck.trim() === "") return null;
  const n = typeof page === "string" && /^\d{1,5}$/.test(page.trim()) ? Number(page.trim()) : 0;
  return n > 0 ? { selection: stuck.trim(), page: n } : null;
}
