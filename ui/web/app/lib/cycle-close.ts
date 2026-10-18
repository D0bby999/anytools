/**
 * cycle-close.ts
 * The structured day-90 close on a cycle's page (up methods, phase 10): what
 * the API answers about a cycle's closes, and the small rules the page
 * applies to it. The kind itself is served by the API; the server refuses an
 * unfinished stop and a transfer with no condition — the page only shows
 * what is missing before it does.
 */
import type { TableRow, WorksheetSummary } from "~/lib/worksheet-types";
import type { WeeklyQuestion } from "~/lib/loop-types";

export const CYCLE_CLOSE_KIND = "cycle_close";

/** One row of a close's destinations table; `row` is its index there. */
export type Destination = {
  row: number;
  result: string;
  destination: "continue" | "transfer" | "repair" | "stop" | string;
  next_step: string;
  condition?: string;
};

export type PreviousClose = {
  id: string;
  title: string;
  cycle_id?: string;
  /** Continue and transfer rows that name a next step. */
  offers: Destination[];
  /** Repair rows: what to reduce before anything else. */
  reduce_first: Destination[];
};

export type CycleCloses = {
  close: WorksheetSummary | null;
  previous: PreviousClose | null;
};

/** Whether the page offers "Close this cycle": from day 84 on the learner's calendar. */
export function canClose(day: number, closeFromDay: number): boolean {
  return day >= closeFromDay;
}

/** Week 1's question is still empty, so the last close may fill it. */
export function weekOneIsEmpty(questions: WeeklyQuestion[]): boolean {
  return !questions[0]?.question.trim();
}

/** The weekly questions with week 1's question set, its capacity kept. */
export function withWeekOne(questions: WeeklyQuestion[], question: string): WeeklyQuestion[] {
  const first: WeeklyQuestion = { question, capacity: questions[0]?.capacity || "full" };
  return [first, ...questions.slice(1)];
}

/** A close's title, cut to fit a worksheet's 200 characters. */
export function closeTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > 200 ? `${trimmed.slice(0, 199)}…` : trimmed;
}

const text = (row: TableRow, key: string) => {
  const v = row.cells[key];
  return typeof v === "string" ? v.trim() : "";
};

/** What a destinations row still needs, as keys of the toolkit's cycleClose.missing strings. */
export function missingForRow(row: TableRow): string[] {
  const destination = text(row, "destination");
  if (destination === "transfer") return text(row, "condition") ? [] : ["condition"];
  if (destination !== "stop") return [];
  return ["basis", "archived", "told"].filter((key) => !text(row, key));
}
