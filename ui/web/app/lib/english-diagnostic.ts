/**
 * english-diagnostic.ts
 * What the page adds to up's English diagnostic (up methods, phase 1) beyond
 * the served kind: §4's row totals, and §5's "Evidence card", which opens the
 * matching full evidence worksheet as up links to its templates
 * (english-diagnostic.md §5). Pure, so it is tested without a page.
 *
 * The kind itself — sections, rows, options, help — is served by the API
 * like any other; only these ids are known here.
 */
import type { TableRow, WorksheetField, WorksheetKind, WorksheetSection } from "~/lib/worksheet-types";

export const DIAGNOSTIC_KIND = "english_diagnostic";

/** §5's rows and the worksheet kind each one's evidence card opens (phases 2, 4, 5, 7). */
export const EVIDENCE_KINDS: Record<string, string> = {
  listening: "listening_audit",
  reading: "reading_evidence",
  speaking: "speaking_evidence",
  writing: "writing_evidence",
};

/** The skill-card kinds that count as language work (internal/learning/loop/cards.go). */
export const LANGUAGE_CARD_KINDS = new Set(["reading", "writing", "speaking", "listening", "vocabulary", "grammar"]);

/** A row's total over the table's score columns, and the most it could be. */
export function scoreTotal(field: WorksheetField, row: TableRow): { total: number; max: number; scored: number } {
  let total = 0;
  let scored = 0;
  let max = 0;
  for (const c of field.columns ?? []) {
    if (c.type !== "score") continue;
    max += 2;
    const v = row.cells[c.key];
    if (typeof v === "number") {
      total += v;
      scored += 1;
    }
  }
  return { total, max, scored };
}

/** How the evidence card of one skill can be opened. */
export type EvidenceTarget =
  /** The kind is not served yet (its phase has not landed): its name only. */
  | { mode: "absent" }
  /** It attaches to a document, so it is started from that document. */
  | { mode: "document"; kind: WorksheetKind }
  /** It can be created or opened from here. */
  | { mode: "open"; kind: WorksheetKind };

export function evidenceTarget(skill: string, kinds: WorksheetKind[]): EvidenceTarget {
  const id = EVIDENCE_KINDS[skill];
  const kind = id ? kinds.find((k) => k.kind === id) : undefined;
  if (!kind) return { mode: "absent" };
  return kind.attach === "document" ? { mode: "document", kind } : { mode: "open", kind };
}

/** The title an evidence worksheet opened from a diagnostic gets, and is found again by. */
export function evidenceTitle(kind: WorksheetKind, diagnosticTitle: string): string {
  return `${kind.name}: ${diagnosticTitle}`.slice(0, 200);
}

/**
 * Where a prefill goes: the first one-line or prose field of the kind's first
 * section (in up's evidence templates, "Real situation").
 */
export function prefillTarget(kind: WorksheetKind): { section: WorksheetSection; field: WorksheetField } | null {
  const section = kind.sections[0];
  const field = section?.fields.find((f) => f.type === "text" || f.type === "long");
  return section && field ? { section, field } : null;
}

/** A prefill cut to what its field holds. */
export function clampPrefill(field: WorksheetField, text: string): string {
  return text.trim().slice(0, field.type === "long" ? 5000 : 500);
}
