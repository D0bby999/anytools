/**
 * chat-work.ts — how an answer was found, in one shape for both halves.
 *
 * A stored answer carries its work record in `attachments.work` (written by
 * internal/capabilities/chat, plan 261019-1015). A live turn has only its
 * tool_call / tool_result frames. Both become `WorkView`, so the row under an
 * answer looks the same while it streams and after a reload.
 */
import type { ToolActivity } from "~/hooks/use-turn-stream";

export type WorkStep = {
  tool: string;
  detail?: string;
  found?: number;
  error?: boolean;
  repeated?: boolean;
  ms?: number;
  running?: boolean;
};

export type WorkView = {
  steps: WorkStep[];
  /** Earlier messages folded into the conversation's summary on this turn. */
  summarised?: number;
  /** The answer hit the output limit and was continued once. */
  continued?: boolean;
  /** Every tool round was used; the answer came from what was found. */
  limitReached?: boolean;
  ms?: number;
  contextTokens?: number;
  contextWindow?: number;
  /** Where earlier messages start to be summarised (chat history budget). */
  historyBudget?: number;
};

/** Follow-up kinds the server may offer (capabilities/chat/suggestions.go). */
export const FOLLOW_UPS = ["check", "simpler", "example", "broaden"] as const;
export type FollowUp = (typeof FOLLOW_UPS)[number];

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Reads a stored or streamed work record; null when there is none. */
export function readWork(raw: unknown): WorkView | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const steps = Array.isArray(r.steps)
    ? r.steps.flatMap((s): WorkStep[] => {
        if (!s || typeof s !== "object") return [];
        const x = s as Record<string, unknown>;
        if (typeof x.tool !== "string") return [];
        return [
          {
            tool: x.tool,
            detail: typeof x.detail === "string" ? x.detail : undefined,
            found: num(x.found),
            error: x.error === true,
            repeated: x.repeated === true,
            ms: num(x.ms),
          },
        ];
      })
    : [];
  return {
    steps,
    summarised: num(r.summarised),
    continued: r.continued === true,
    limitReached: r.limit_reached === true,
    ms: num(r.ms),
    contextTokens: num(r.context_tokens),
    contextWindow: num(r.context_window),
    historyBudget: num(r.history_budget),
  };
}

/** Reads the follow-up kinds, keeping only ones this client knows. */
export function readFollowUps(raw: unknown): FollowUp[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((k): k is FollowUp => (FOLLOW_UPS as readonly string[]).includes(k as string));
}

/** A live turn's tool frames as work steps. */
export function liveWork(tools: ToolActivity[]): WorkView {
  return {
    steps: tools.map((t) => ({
      tool: t.name,
      detail: t.argument,
      found: t.found,
      error: t.status === "error",
      repeated: t.repeated,
      running: t.status === "running",
    })),
  };
}

/** Tools whose steps count as reading the learner's own material. */
const SEARCHES = new Set(["rag_search", "zotero_search", "paper_search", "web_search"]);

/** Totals for the folded row: searches made, passages found, other steps. */
export function workTotals(work: WorkView) {
  let searches = 0;
  let passages = 0;
  for (const s of work.steps) {
    if (s.repeated) continue;
    if (SEARCHES.has(s.tool)) searches++;
    passages += s.found ?? 0;
  }
  return { searches, passages, steps: work.steps.filter((s) => !s.repeated).length };
}
