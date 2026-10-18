/**
 * ladder.ts
 * Up-methods phase 2: the listening audit's scaffold ladder decides what a
 * video's page shows (up: docs/en/threads/part-1/3-listening.md §5, "Captions
 * Are a Ladder That Can Be Removed"). Pure, so every stage is tested without
 * a page.
 *
 * Stage 1 is a first pass with no captions and stage 2 replays only the
 * problem segment, so the transcript, the study notes and the tutor (which
 * can quote the transcript) are out of sight. Stage 3 opens the transcript;
 * stage 4 keeps it. Stage 5 closes the text again, until the learner marks it
 * done. Stage 6 is the delayed retest, days later.
 *
 * This is a page behaviour, not a secret: the transcript is the learner's own
 * document and the API serves it as before.
 */
import type { Answers, FieldValue, TableRow } from "~/lib/worksheet-types";

/** Where the ladder lives in a listening audit (kinds_listening_audit.go). */
export const LADDER = { section: "ladder", field: "stages", column: "visible" } as const;
export const LADDER_STAGES = 6;

/** The ladder's rows, from stored answers or a section's live values. */
export function ladderRows(table: FieldValue | undefined): TableRow[] {
  return Array.isArray(table) ? (table as TableRow[]) : [];
}

export function ladderOf(answers: Answers | undefined): TableRow[] {
  return ladderRows(answers?.[LADDER.section]?.[LADDER.field]);
}

/**
 * The current stage, 1–6, or 7 once every stage is done: the first stage
 * whose "what became visible" is empty, or the one after the last stage the
 * learner marked done, whichever is later.
 */
export function currentStage(rows: TableRow[], markedDone = 0): number {
  let first = LADDER_STAGES + 1;
  for (let n = 1; n <= LADDER_STAGES; n++) {
    const v = rows.find((r) => r.row === `stage${n}`)?.cells[LADDER.column];
    if (typeof v !== "string" || v.trim() === "") {
      first = n;
      break;
    }
  }
  const after = Math.min(LADDER_STAGES + 1, Math.max(0, Math.floor(markedDone)) + 1);
  return Math.max(first, after);
}

/** Whether the transcript, the study notes and the tutor are on screen at a stage. */
export function transcriptVisible(stage: number): boolean {
  return stage !== 1 && stage !== 2 && stage !== 5;
}

export type ListeningView = {
  /** 0 when the video has no open listening audit. */
  stage: number;
  /** Why the transcript is away, or null when it is on screen. */
  hidden: null | "stage" | "retelling";
};

/**
 * What the video's page shows. With no open audit there is no ladder, and
 * nothing is hidden. While the learner writes the retelling (§7, "after
 * closing the text"), the transcript is away whatever the stage.
 */
export function listeningView(rows: TableRow[] | null, markedDone = 0, retelling = false): ListeningView {
  if (!rows) return { stage: 0, hidden: null };
  const stage = currentStage(rows, markedDone);
  if (!transcriptVisible(stage)) return { stage, hidden: "stage" };
  return { stage, hidden: retelling ? "retelling" : null };
}

/** A replayed segment's default length, when only its start is known (up: 5–20 seconds). */
export const SEGMENT_SECONDS = 20;

/** The range a Play button replays: to `end` when it comes after `start`, else 20 seconds. */
export function segmentRange(start: number, end?: number | null): { start: number; end: number } {
  return { start, end: end !== undefined && end !== null && end > start ? end : start + SEGMENT_SECONDS };
}

/** Where the learner's explicit "stage done" is kept, on this device only. */
export function markedDoneKey(worksheetId: string): string {
  return `anytools:listening-ladder:${worksheetId}`;
}
