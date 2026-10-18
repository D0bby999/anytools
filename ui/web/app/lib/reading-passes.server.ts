/**
 * reading-passes.server.ts
 * The reader's "Read in five passes" (up-methods phase 5): the document's
 * open reading evidence worksheet, found or created from the document the URL
 * names. The page never posts a worksheet id; every write goes to the
 * worksheet found here, which the API resolves with the caller's id again.
 */
import { appendRow, createWorksheet, getWorksheet, listKinds, listWorksheets } from "~/lib/worksheets.server";
import { getDocument } from "~/lib/kb.server";
import type { WorksheetDetail, WorksheetSummary } from "~/lib/worksheet-types";
import { BARRIERS, READING_KIND, barrierRow } from "~/lib/reading-passes";

export type ReadingPassesData = {
  /** Whether the reading card attaches to this kind of document (a video does not). */
  allowed: boolean;
  sheet: WorksheetDetail | null;
};

/** The document's open reading evidence worksheet, newest first. */
export async function findReadingSheet(userId: string, docId: string): Promise<WorksheetSummary | undefined> {
  const list = await listWorksheets(userId, { kind: READING_KIND, documentId: docId });
  return list.find((w) => w.status === "open");
}

/** What the panel shows: the open worksheet, or whether one may be started. */
export async function loadReadingPasses(userId: string, docId: string, sourceKind: string): Promise<ReadingPassesData> {
  const open = await findReadingSheet(userId, docId);
  if (open) return { allowed: true, sheet: await getWorksheet(userId, open.id) };
  const kind = (await listKinds(userId)).find((k) => k.kind === READING_KIND);
  const kinds = kind?.document_kinds ?? [];
  return { allowed: Boolean(kind) && (kinds.length === 0 || kinds.includes(sourceKind)), sheet: null };
}

/** Opens the document's worksheet, creating it the first time. */
export async function openReadingSheet(userId: string, docId: string): Promise<{ id: string }> {
  const open = await findReadingSheet(userId, docId);
  if (open) return open;
  const view = await getDocument(userId, docId);
  const title = `Reading: ${view.document.title}`.slice(0, 200);
  return createWorksheet(userId, { kind: READING_KIND, title, document_id: docId });
}

/**
 * "Mark a barrier": one §4 row appended server-side, so it never rewrites
 * the copy of the table the panel holds.
 */
export async function markBarrier(userId: string, docId: string, selection: string, page: number) {
  const sheet = await openReadingSheet(userId, docId);
  return appendRow(userId, sheet.id, { section: BARRIERS.section, field: BARRIERS.field, row: barrierRow(selection, page) });
}
