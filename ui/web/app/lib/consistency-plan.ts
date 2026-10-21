/**
 * consistency-plan.ts
 * The consistency plan's start from a learning state (the private design notes, phase 2): "Three versions" may open with the state's
 * minimum version of its next task in the Minimum row and the next task in
 * the Standard row. The new-worksheet page shows both and the learner
 * confirms; the plan is new, so nothing is overwritten. Only these two
 * fields are read: the bad-day contract's ask_for_help_when is private.
 * Pure, so it is tested without a page.
 */
import type { Answers } from "~/lib/worksheet-types";
import type { LearningState } from "~/lib/loop-types";

export const CONSISTENCY_PLAN_KIND = "consistency_plan";

/** Where the prefill goes (internal/learning/worksheet/kinds_consistency_plan.go). */
const SECTION = "versions";
const TABLE = "versions";
const ACTION = "action";

export type VersionsPrefill = { minimum: string; standard: string };

export function prefillFrom(state: Pick<LearningState, "next_task" | "next_task_minimum">): VersionsPrefill {
  return { minimum: (state.next_task_minimum ?? "").trim(), standard: (state.next_task ?? "").trim() };
}

export const hasPrefill = (p: VersionsPrefill) => p.minimum !== "" || p.standard !== "";

/** The answers a confirmed prefill writes: only the rows it has text for. */
export function versionsAnswers(p: VersionsPrefill): Answers {
  const rows = (
    [
      ["minimum", p.minimum],
      ["standard", p.standard],
    ] as const
  )
    .filter(([, v]) => v !== "")
    .map(([row, v]) => ({ row, cells: { [ACTION]: v } }));
  return rows.length > 0 ? { [SECTION]: { [TABLE]: rows } } : {};
}
