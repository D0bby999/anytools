/**
 * reading-selection.ts
 * What the reader has selected, and which page it came from. Client-safe.
 */
import { MAX_SELECTION } from "~/lib/reading-types";

export type ReaderSelection = { text: string; page: number };

/**
 * Reads the current selection inside `root`, or null.
 *
 * The page is taken from the nearest `[data-page]` ancestor of the selection's
 * START: both renderers mark every page section with it, and a selection that
 * runs across a page break is filed under the page it began on — which is the
 * page a citation to it would open.
 *
 * Whitespace is collapsed because pdf.js's text layer puts every run in its own
 * span and a copied line comes back with the layout's spacing, not the
 * sentence's. Anything longer than the API accepts is trimmed here rather than
 * sent and refused.
 */
export function readSelection(root: HTMLElement, selection: Selection | null): ReaderSelection | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const text = selection.toString().replace(/\s+/g, " ").trim().slice(0, MAX_SELECTION);
  if (!text) return null;

  const start = range.startContainer;
  const element = start instanceof Element ? start : start.parentElement;
  const pageAttr = element?.closest<HTMLElement>("[data-page]")?.dataset.page;
  const page = Number(pageAttr);
  return { text, page: Number.isInteger(page) && page > 0 ? page : 0 };
}

/**
 * The page a stored reading-action message was asked about.
 *
 * readingapi writes the user message as `Explain (page 12):\n\n> …`
 * (reading.Request.TranscriptMessage). This is the one place that reads the
 * format back, so a note saved from a tutor answer keeps the page the question
 * was about.
 */
export function transcriptPage(message: string): number {
  const match = /^[^\n]*\(page (\d+)\):/.exec(message);
  return match ? Number(match[1]) : 0;
}
