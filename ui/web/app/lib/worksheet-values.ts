/**
 * worksheet-values.ts
 * What one section of a worksheet sends when it autosaves. Pure, so it is
 * tested without a page.
 *
 * Every field of the section the kind knows is sent, an empty one as null
 * (the API reads null as "clear it"). Keys the kind no longer has are never
 * sent: the API refuses them, and keeps them as they were.
 */
import type { CellValue, FieldValue, TableRow, WorksheetField, WorksheetSection } from "~/lib/worksheet-types";

export type SectionValues = Record<string, FieldValue | undefined>;

/** The stored values of the fields this section still has. */
export function initialValues(section: WorksheetSection, stored: Record<string, FieldValue> | undefined): SectionValues {
  const out: SectionValues = {};
  for (const f of section.fields) {
    if (stored && f.key in stored) out[f.key] = stored[f.key];
  }
  return out;
}

export function isEmpty(v: FieldValue | undefined): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function cleanCells(field: WorksheetField, cells: Record<string, CellValue>): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  for (const c of field.columns ?? []) {
    if (c.type === "label") continue;
    const v = cells[c.key];
    if (!isEmpty(v) && v !== undefined) out[c.key] = v;
  }
  return out;
}

/**
 * A table's rows as sent: a fixed table sends only the rows that hold
 * something (an untouched dated row is not a write), a free table every row
 * the learner kept, in order.
 */
export function tablePayload(field: WorksheetField, rows: TableRow[]): TableRow[] {
  const fixed = (field.rows ?? []).length > 0;
  const out: TableRow[] = [];
  for (const r of rows) {
    const cells = cleanCells(field, r.cells ?? {});
    if (fixed && Object.keys(cells).length === 0) continue;
    out.push({ row: fixed ? r.row : "", cells });
  }
  return out;
}

/** The section's PATCH body: field → value or null. */
export function sectionPayload(section: WorksheetSection, values: SectionValues): Record<string, FieldValue | null> {
  const out: Record<string, FieldValue | null> = {};
  for (const f of section.fields) {
    if (f.type === "label") continue;
    const v = values[f.key];
    if (f.type === "table") {
      const rows = tablePayload(f, Array.isArray(v) ? (v as TableRow[]) : []);
      out[f.key] = rows.length > 0 ? rows : null;
      continue;
    }
    out[f.key] = isEmpty(v) || v === undefined ? null : typeof v === "string" ? v.trim() : v;
  }
  return out;
}

/** Whether a field with a show_when is shown, given its section's values. */
export function shown(field: WorksheetField, values: SectionValues): boolean {
  const c = field.show_when;
  if (!c) return true;
  let v: FieldValue | undefined = values[c.field];
  if (c.row !== undefined) {
    const rows = Array.isArray(v) ? (v as TableRow[]) : [];
    v = rows.find((r) => r.row === c.row)?.cells[c.column ?? ""];
  }
  return v === c.equals;
}

/** Whether a column is used on a fixed table's row. */
/** What a label column shows in a row: its text for the row's key, or for the row's answer in `text_from`. */
export function labelText(column: WorksheetField, row: TableRow): string {
  if (!column.text_from) return column.text?.[row.row] ?? "";
  const v = row.cells[column.text_from];
  return typeof v === "string" ? (column.text?.[v] ?? "") : "";
}

export function columnApplies(column: WorksheetField, row: string): boolean {
  return !column.for_rows || column.for_rows.length === 0 || column.for_rows.includes(row);
}
