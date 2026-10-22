/**
 * reading-selection.ts
 * What the reader has selected, and which page it came from. Client-safe.
 */
import { MAX_SELECTION, READING_ACTIONS, type ReadingAction } from "~/lib/reading-types";

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

/**
 * The head readingapi stores for each action, in English whatever the
 * interface language (reading.Label; reading_test.go pins the same four).
 * A stored transcript is matched on these, never on a translated label: in
 * Vietnamese "Từ vựng ở đây" is never the start of "Vocabulary here (page 1):".
 */
export const STORED_ACTION_HEADS: Record<ReadingAction, string> = {
  explain: "Explain this",
  vocab: "Vocabulary here",
  quiz: "Quiz me on this",
  translate: "Translate this",
};

/** The action a stored reading message was, or null for a typed question. */
export function transcriptAction(message: string): ReadingAction | null {
  const head = message.split("\n", 1)[0] ?? "";
  for (const act of READING_ACTIONS) {
    const stored = STORED_ACTION_HEADS[act];
    if (head === stored || head.startsWith(`${stored} (`) || head.startsWith(`${stored}:`)) return act;
  }
  return null;
}

/** The stored line for an action, as readingapi writes it, for the pending question. */
export function storedActionHead(act: ReadingAction, where: { page?: number; clock?: string }): string {
  const head = STORED_ACTION_HEADS[act];
  if (where.clock) return `${head} (at ${where.clock})`;
  return where.page && where.page > 0 ? `${head} (page ${where.page})` : head;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The message as the learner reads it: the stored English head in the
 * interface language ("Từ vựng ở đây (trang 1):"). Display only; the stored
 * text, and every reader of its format, stay as they are.
 */
export function transcriptHead(message: string, t: Translate): string {
  const act = transcriptAction(message);
  if (!act) return message;
  const newline = message.indexOf("\n");
  const first = newline < 0 ? message : message.slice(0, newline);
  const rest = newline < 0 ? "" : message.slice(newline);
  const tail = first.slice(STORED_ACTION_HEADS[act].length);
  const page = /^ \(page (\d+)\)/.exec(tail);
  const at = /^ \(at ([\d:]+)\)/.exec(tail);
  let head = t(`actionLabels.${act}`);
  let after = tail;
  if (page) {
    head += ` ${t("tutor.onPage", { page: Number(page[1]) })}`;
    after = tail.slice(page[0].length);
  } else if (at) {
    head += ` ${t("tutor.atMoment", { clock: at[1] })}`;
    after = tail.slice(at[0].length);
  }
  return `${head}${after}${rest}`;
}
