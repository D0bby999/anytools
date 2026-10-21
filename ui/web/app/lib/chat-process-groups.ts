/**
 * chat-process-groups.ts — how one answer's work is grouped and folded (pure).
 *
 * After postclaw's lib/chat-process-groups.ts (DeepSeek Harness `standard`
 * work details), fitted to what AnyTools stores: an answer's work is a flat
 * list of tool steps (lib/chat-work.ts), with no intermediate messages to
 * break it, so a GROUP here is a maximal run of steps of one category
 * ("Searched" ×3, then "Read sources" ×2). Live reasoning, when the model
 * streams any, is a group of its own ahead of the steps.
 *
 * Fold rules, postclaw's:
 *  - while the answer streams, its process is open (each group folded, the
 *    live one naming what it is doing);
 *  - a turn that failed or was stopped stays open: its work is why the reader
 *    is looking;
 *  - a turn that completed folds behind one row, so the answer sits under the
 *    question; the reader's own choice wins.
 */
import type { WorkStep } from "~/lib/chat-work";
import { rankCategories, toolCategory, type ProcessCategory } from "~/lib/chat-tool-categories";

export type ProcessGroup = {
  /** Fold key, stable while streaming: it names the group's first step. */
  key: string;
  category: ProcessCategory;
  steps: WorkStep[];
  /** Live reasoning text, for the thinking group. */
  thinking?: string;
  /** The step running now, when the turn streams. */
  live: WorkStep | null;
  /** True for a running thinking group. */
  liveThinking: boolean;
  hasError: boolean;
};

export type TurnState = "running" | "done" | "interrupted";

export function groupSteps(steps: WorkStep[], opts: { thinking?: string; running?: boolean } = {}): ProcessGroup[] {
  const groups: ProcessGroup[] = [];
  const thinking = opts.thinking?.trim() ?? "";
  if (thinking !== "") {
    groups.push({
      key: "thinking",
      category: "thinking",
      steps: [],
      thinking,
      live: null,
      // Thinking is live until the first tool step starts.
      liveThinking: !!opts.running && steps.length === 0,
      hasError: false,
    });
  }
  steps.forEach((step, i) => {
    const category = toolCategory(step.tool);
    const last = groups.at(-1);
    if (last && last.category === category && last.key !== "thinking") {
      last.steps.push(step);
    } else {
      groups.push({ key: `step-${i}`, category, steps: [step], live: null, liveThinking: false, hasError: false });
    }
  });
  for (const g of groups) {
    g.live = opts.running ? ([...g.steps].reverse().find((s) => s.running) ?? null) : null;
    g.hasError = g.steps.some((s) => s.error);
  }
  return groups;
}

/** The categories across the whole answer's work, for the folded turn row. */
export function turnCategories(steps: WorkStep[], thinking = false): ProcessCategory[] {
  return rankCategories([
    ...(thinking ? [{ kind: "thinking" as const }] : []),
    ...steps.filter((s) => !s.repeated).map((s) => ({ kind: "tool" as const, name: s.tool })),
  ]);
}

/** Only a completed turn folds; the reader's explicit choice wins there. */
export function isTurnOpen(state: TurnState, explicit: boolean | undefined): boolean {
  if (state !== "done") return true;
  return explicit ?? false;
}

/** Groups start folded; the reader's choice wins. */
export function isGroupOpen(explicit: boolean | undefined): boolean {
  return explicit ?? false;
}

/** The short live detail of a running step: its argument, at most 60 characters. */
export function liveDetail(step: WorkStep | null): string {
  const text = step?.detail?.trim().replace(/\s+/g, " ") ?? "";
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}
