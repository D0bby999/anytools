/**
 * use-turn-stream.ts
 *
 * Turns a stream of DeepTutor-shaped events into the state a chat screen
 * renders: the answer as it arrives, the thinking, the tool activity, the
 * sources, and whether the turn is waiting on a question.
 *
 * The reducer is deliberately additive and keyed on seq. A refresh mid-stream
 * replays from the cursor, and text that arrived twice would be text the user
 * sees twice — so every frame is applied at most once, by seq, and the seq the
 * reducer has seen is the cursor a reconnect resumes from.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useEventStream, type StreamFrame, type StreamStatus } from "~/hooks/use-event-stream";

/** The 15 DeepTutor event types, with `error` renamed on the wire. */
export const TURN_EVENTS = [
  "stage_start",
  "stage_end",
  "thinking",
  "observation",
  "content",
  "tool_call",
  "tool_result",
  "progress",
  "sources",
  "result",
  "stream_error", // server-side `error`; see use-event-stream.ts
  "session",
  "session_meta",
  "done",
  "wait_for_input",
] as const;

/** One citable reference, as the `sources` event carries it. */
export type Source = {
  kind: string;
  id: string;
  title?: string;
  page?: number;
  document_id?: string;
  /** Set for kind `url` (phase 9's web research): the page the chip opens. */
  url?: string;
  /** Set for a timed video passage: where the cited segment starts. */
  seconds?: number;
  /** A passage from an AI transcript, which can mishear. */
  ai_transcript?: boolean;
  /** A code file's passage: `page` is its first line and this its last. */
  line_end?: number;
  /** Set for a spreadsheet passage: the sheet it is on (retrieve.Hit.Sheet). */
  sheet?: string;
  /** Set for a passage read from a photo: the model that read it (retrieve.Hit.PhotoModel). */
  photo_model?: string;
};

/** One tool round, as the activity panel shows it. */
export type ToolActivity = {
  callId: string;
  name: string;
  status: "running" | "done" | "error";
  detail?: string;
  /** What the call was for: its query, title or page (chat-work.ts). */
  argument?: string;
  /** Passages the call returned. */
  found?: number;
  /** The same call was already made in this turn and was not run again. */
  repeated?: boolean;
};

/**
 * The pending ask_user question.
 *
 * `id` is echoed back with the answer. It is what stops a retried POST from
 * being consumed by a LATER question in the same turn - from the server's side
 * the two are otherwise indistinguishable.
 */
export type PendingQuestion = { id: string; question: string; options: string[] };

/** The payload of every frame, mirroring Go's runtime.Event. */
type TurnEvent = {
  type: string;
  source?: string;
  stage?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  seq: number;
};

export type TurnState = {
  /** The answer so far, assembled from content deltas then replaced by result. */
  answer: string;
  thinking: string;
  stage: string | null;
  tools: ToolActivity[];
  sources: Source[];
  question: PendingQuestion | null;
  /** Stages that have ended, in order — staged capabilities (solve, research)
   *  bracket each one, and a progress list reads these rather than guessing. */
  stagesDone: string[];
  /** Plain-language notes the turn made along the way ("no web search key…"). */
  observations: string[];
  /** The `result` event's metadata: solve's message id, research's report id. */
  resultMeta: Record<string, unknown> | null;
  /** Set when the turn ended badly. */
  failure: { message: string; code?: string; retryable?: boolean } | null;
  /** The turn ended because it was stopped, not because it failed. */
  cancelled: boolean;
  /** Earlier messages were summarised to make room (a `progress` frame). */
  compacted: number;
  /** The model the turn is using, from `session_meta`. */
  model: string | null;
  finished: boolean;
  lastSeq: number;
};

const EMPTY: TurnState = {
  answer: "",
  thinking: "",
  stage: null,
  tools: [],
  sources: [],
  question: null,
  stagesDone: [],
  observations: [],
  resultMeta: null,
  failure: null,
  cancelled: false,
  compacted: 0,
  model: null,
  finished: false,
  lastSeq: 0,
};

export function useTurnStream(turnId: string | null, opts?: { afterSeq?: number }) {
  const [state, setState] = useState<TurnState>(EMPTY);

  // Seqs already applied. A replay after a reconnect re-delivers frames the
  // reducer has seen; applying a content delta twice would duplicate text in
  // the middle of a sentence, which is the exact symptom the phase's
  // acceptance criterion names ("refresh mid-stream resumes without duplicate
  // text").
  const seen = useRef<Set<number>>(new Set());

  const onFrame = useCallback((frame: StreamFrame<TurnEvent>) => {
    const ev = frame.data;
    const seq = ev.seq || frame.seq;
    if (seq > 0) {
      if (seen.current.has(seq)) return;
      seen.current.add(seq);
    }
    setState((prev) => reduce(prev, ev, seq));
  }, []);

  const url = turnId ? `/app/api/stream/turns/${turnId}` : null;

  const { status, reconnect } = useEventStream<TurnEvent>({
    url,
    events: TURN_EVENTS,
    onFrame,
    afterSeq: opts?.afterSeq ?? 0,
    isTerminal: (frame) => frame.name === "done" || frame.name === "stream_error",
  });

  // A new turn starts from nothing; without this the previous turn's answer
  // would still be on screen while the next one streams in underneath it.
  const lastTurn = useRef<string | null>(null);
  if (turnId !== lastTurn.current) {
    lastTurn.current = turnId;
    seen.current = new Set();
    if (state !== EMPTY) setState(EMPTY);
  }

  return useMemo(
    () => ({ ...state, status: status as StreamStatus, reconnect }),
    [state, status, reconnect],
  );
}

function reduce(prev: TurnState, ev: TurnEvent, seq: number): TurnState {
  const next: TurnState = { ...prev, lastSeq: Math.max(prev.lastSeq, seq) };

  switch (ev.type) {
    case "stage_start":
      next.stage = ev.stage ?? null;
      return next;

    case "stage_end":
      // Only clear the stage the event names: a nested stage ending must not
      // erase the label of the one still running.
      next.stage = prev.stage === ev.stage ? null : prev.stage;
      if (ev.stage && !prev.stagesDone.includes(ev.stage)) {
        next.stagesDone = [...prev.stagesDone, ev.stage];
      }
      return next;

    case "thinking":
      next.thinking = prev.thinking + (ev.content ?? "");
      return next;

    case "content":
      next.answer = prev.answer + (ev.content ?? "");
      return next;

    case "result":
      // The validated answer replaces the accumulated deltas: citations the
      // turn could not support were removed server-side, and the deltas still
      // hold them.
      next.answer = ev.content ?? prev.answer;
      next.resultMeta = ev.metadata ?? null;
      return next;

    case "tool_call": {
      const callId = str(ev.metadata?.call_id) || `call-${seq}`;
      next.tools = [
        ...prev.tools,
        {
          callId,
          name: str(ev.metadata?.tool) || ev.content || "tool",
          status: "running",
          argument: argumentOf(ev.metadata?.arguments),
        },
      ];
      return next;
    }

    case "tool_result": {
      const callId = str(ev.metadata?.call_id);
      const failed = ev.metadata?.error === true;
      const found = ev.metadata?.sources;
      next.tools = prev.tools.map((t) =>
        t.callId === callId
          ? {
              ...t,
              status: failed ? "error" : "done",
              detail: ev.content,
              found: typeof found === "number" ? found : undefined,
              repeated: ev.metadata?.repeated === true,
            }
          : t,
      );
      return next;
    }

    case "sources":
      next.sources = asSources(ev.metadata?.sources);
      return next;

    case "wait_for_input":
      next.question = {
        id: str(ev.metadata?.question_id),
        question: str(ev.metadata?.question) || ev.content || "",
        options: asStrings(ev.metadata?.options),
      };
      return next;

    case "observation":
      // An observation that reports the question was answered clears the card.
      if (ev.metadata?.answered === true) {
        next.question = null;
        return next;
      }
      // Observations with metadata are bookkeeping ("discarded an answer",
      // "note_saved") that the UI reads elsewhere; the rest are sentences a
      // capability addressed to the reader, such as research's "no web search
      // key is connected". Chat does not render them.
      if (ev.content && ev.stage && !ev.metadata) {
        next.observations = [...prev.observations, ev.content];
      }
      return next;

    case "progress":
      if (ev.metadata?.kind === "compaction" && typeof ev.metadata.messages === "number") {
        next.compacted = prev.compacted + ev.metadata.messages;
      }
      return next;

    case "session_meta":
      next.model = str(ev.metadata?.model) || prev.model;
      return next;

    case "error":
      // A stop arrives as an `error` frame with status `cancelled`. It stays
      // a failure for the pages that only show one; chat reads `cancelled`.
      next.cancelled = ev.metadata?.status === "cancelled";
      next.failure = {
        message: ev.content || "This turn stopped before it finished.",
        code: str(ev.metadata?.failure_code) || undefined,
        retryable: ev.metadata?.retryable === true,
      };
      next.finished = true;
      next.question = null;
      return next;

    case "done":
      next.finished = true;
      next.question = null;
      return next;

    default:
      // session: nothing on screen depends on it.
      return next;
  }
}

/** The argument a reader recognises a call by (mirrors chat/tools.go argDetail). */
function argumentOf(v: unknown): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  const args = v as Record<string, unknown>;
  for (const key of ["query", "question", "q", "title", "path"]) {
    const s = args[key];
    if (typeof s === "string" && s.trim() !== "") return s.trim();
  }
  if (typeof args.page === "number") return `p. ${args.page}`;
  return undefined;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function asSources(v: unknown): Source[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== "string" || typeof rec.kind !== "string") return [];
    return [
      {
        kind: rec.kind,
        id: rec.id,
        title: typeof rec.title === "string" ? rec.title : undefined,
        page: typeof rec.page === "number" ? rec.page : undefined,
        document_id: typeof rec.document_id === "string" ? rec.document_id : undefined,
        url: typeof rec.url === "string" ? rec.url : undefined,
      },
    ];
  });
}
