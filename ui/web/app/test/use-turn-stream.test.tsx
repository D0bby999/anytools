/**
 * use-turn-stream.test.tsx
 *
 * jsdom has no EventSource, so one is installed here. It is not only a stub: it
 * is the mechanism the tests below drive, and it reproduces the two behaviours
 * that matter — a frame is dispatched to a listener named after its `event:`
 * field, and `lastEventId` carries the `id:`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useTurnStream } from "~/hooks/use-turn-stream";

type Listener = (event: MessageEvent<string>) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  private listeners = new Map<string, Set<Listener>>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, fn: Listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(fn);
  }

  removeEventListener(name: string, fn: Listener) {
    this.listeners.get(name)?.delete(fn);
  }

  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  /** Delivers one frame, as the browser would. */
  emit(name: string, payload: unknown, seq: number) {
    this.emitRaw(name, JSON.stringify(payload), seq);
  }

  /** Delivers a frame whose data is whatever the caller says, valid or not. */
  emitRaw(name: string, data: string, seq: number) {
    const event = { data, lastEventId: String(seq) } as MessageEvent<string>;
    for (const fn of this.listeners.get(name) ?? []) fn(event);
  }

  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function source(): FakeEventSource {
  const s = FakeEventSource.instances.at(-1);
  if (!s) throw new Error("no EventSource was opened");
  return s;
}

describe("useTurnStream", () => {
  it("opens the proxy route for the turn, not the API directly", () => {
    renderHook(() => useTurnStream("11111111-1111-1111-1111-111111111111"));
    expect(source().url).toContain("/app/api/stream/turns/11111111-1111-1111-1111-111111111111");
  });

  it("opens nothing when there is no turn", () => {
    const { result } = renderHook(() => useTurnStream(null));
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(result.current.status).toBe("idle");
  });

  it("assembles content deltas into the answer, then takes the validated result", async () => {
    const { result } = renderHook(() => useTurnStream("t-1"));

    act(() => {
      source().open();
      source().emit("content", { type: "content", content: "Hybrid ", seq: 1 }, 1);
      source().emit("content", { type: "content", content: "retrieval.", seq: 2 }, 2);
    });
    await waitFor(() => expect(result.current.answer).toBe("Hybrid retrieval."));

    // `result` carries the answer AFTER citation validation, so it replaces the
    // deltas rather than appending to them — the deltas still hold markers the
    // server has since dropped.
    act(() => {
      source().emit(
        "result",
        { type: "result", content: "Hybrid retrieval [[cite:chunk:a]].", seq: 3 },
        3,
      );
    });
    await waitFor(() =>
      expect(result.current.answer).toBe("Hybrid retrieval [[cite:chunk:a]]."),
    );
  });

  /**
   * THE acceptance criterion: "refresh mid-stream resumes without duplicate
   * text". A resume replays frames the reducer has already applied, and
   * applying a content delta twice duplicates a phrase mid-sentence.
   */
  it("applies each seq at most once, so a replay cannot duplicate text", async () => {
    const { result } = renderHook(() => useTurnStream("t-1"));

    act(() => {
      source().emit("content", { type: "content", content: "one ", seq: 1 }, 1);
      source().emit("content", { type: "content", content: "two ", seq: 2 }, 2);
    });
    await waitFor(() => expect(result.current.answer).toBe("one two "));

    // The same two frames arrive again, as a reconnect's replay would deliver
    // them, followed by a new one.
    act(() => {
      source().emit("content", { type: "content", content: "one ", seq: 1 }, 1);
      source().emit("content", { type: "content", content: "two ", seq: 2 }, 2);
      source().emit("content", { type: "content", content: "three", seq: 3 }, 3);
    });

    await waitFor(() => expect(result.current.answer).toBe("one two three"));
    expect(result.current.lastSeq).toBe(3);
  });

  it("tracks tool rounds from call to result", async () => {
    const { result } = renderHook(() => useTurnStream("t-1"));

    act(() => {
      source().emit(
        "tool_call",
        { type: "tool_call", content: "rag_search", metadata: { tool: "rag_search", call_id: "c1" }, seq: 1 },
        1,
      );
    });
    await waitFor(() => expect(result.current.tools).toHaveLength(1));
    expect(result.current.tools[0]).toMatchObject({ name: "rag_search", status: "running" });

    act(() => {
      source().emit(
        "tool_result",
        { type: "tool_result", content: "3 passages", metadata: { call_id: "c1" }, seq: 2 },
        2,
      );
    });
    await waitFor(() => expect(result.current.tools[0]?.status).toBe("done"));

    act(() => {
      source().emit(
        "tool_result",
        { type: "tool_result", content: "refused", metadata: { call_id: "c1", error: true }, seq: 3 },
        3,
      );
    });
    await waitFor(() => expect(result.current.tools[0]?.status).toBe("error"));
  });

  it("keeps only well-formed sources from the sources event", async () => {
    const { result } = renderHook(() => useTurnStream("t-1"));

    act(() => {
      source().emit(
        "sources",
        {
          type: "sources",
          metadata: {
            sources: [
              { kind: "chunk", id: "c1", title: "Chapter 3", page: 14, document_id: "doc-1" },
              { kind: "chunk" }, // no id: unusable, and dropped
              "nonsense",
            ],
          },
          seq: 1,
        },
        1,
      );
    });

    await waitFor(() => expect(result.current.sources).toHaveLength(1));
    expect(result.current.sources[0]).toEqual({
      kind: "chunk",
      id: "c1",
      title: "Chapter 3",
      page: 14,
      document_id: "doc-1",
    });
  });

  it("surfaces the ask_user question and clears it once answered", async () => {
    const { result } = renderHook(() => useTurnStream("t-1"));

    act(() => {
      source().emit(
        "wait_for_input",
        {
          type: "wait_for_input",
          content: "Which chapter?",
          metadata: { question: "Which chapter?", options: ["3", "4"] },
          seq: 1,
        },
        1,
      );
    });
    await waitFor(() => expect(result.current.question?.question).toBe("Which chapter?"));
    expect(result.current.question?.options).toEqual(["3", "4"]);

    act(() => {
      source().emit(
        "observation",
        { type: "observation", content: "the user answered", metadata: { answered: true }, seq: 2 },
        2,
      );
    });
    await waitFor(() => expect(result.current.question).toBeNull());
  });

  /**
   * The server's terminal failure arrives as `stream_error` on the wire, with
   * `"type":"error"` inside. Both halves of that rename are exercised here: the
   * listener name, and the payload the reducer switches on.
   */
  it("ends the turn on stream_error and reports the failure code", async () => {
    const { result } = renderHook(() => useTurnStream("t-1"));

    act(() => {
      source().emit(
        "stream_error",
        {
          type: "error",
          content: "this turn stopped because the process running it went away",
          metadata: { failure_code: "WORKER_LOST", retryable: true },
          seq: 7,
        },
        7,
      );
    });

    await waitFor(() => expect(result.current.finished).toBe(true));
    expect(result.current.failure).toEqual({
      message: "this turn stopped because the process running it went away",
      code: "WORKER_LOST",
      retryable: true,
    });
    expect(source().closed, "the stream must be closed on a terminal frame").toBe(true);
  });

  it("ends the turn on done", async () => {
    const { result } = renderHook(() => useTurnStream("t-1"));

    act(() => {
      source().emit("done", { type: "done", metadata: { status: "done" }, seq: 4 }, 4);
    });

    await waitFor(() => expect(result.current.finished).toBe(true));
    expect(result.current.failure).toBeNull();
    expect(source().closed).toBe(true);
  });

  it("resets when a new turn starts, so the previous answer does not linger", async () => {
    const { result, rerender } = renderHook(({ id }: { id: string }) => useTurnStream(id), {
      initialProps: { id: "t-1" },
    });

    act(() => {
      source().emit("content", { type: "content", content: "old answer", seq: 1 }, 1);
    });
    await waitFor(() => expect(result.current.answer).toBe("old answer"));

    rerender({ id: "t-2" });
    await waitFor(() => expect(result.current.answer).toBe(""));

    // And the new turn's seq 1 is applied rather than swallowed as "already
    // seen" from the previous turn.
    act(() => {
      source().emit("content", { type: "content", content: "new answer", seq: 1 }, 1);
    });
    await waitFor(() => expect(result.current.answer).toBe("new answer"));
  });

  it("does not report a failure while EventSource is retrying on its own", async () => {
    const { result } = renderHook(() => useTurnStream("t-1"));

    act(() => {
      source().readyState = FakeEventSource.CONNECTING;
      source().onerror?.();
    });
    await waitFor(() => expect(result.current.status).toBe("connecting"));

    act(() => {
      source().readyState = FakeEventSource.CLOSED;
      source().onerror?.();
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("ignores a frame whose payload is not JSON rather than breaking the stream", async () => {
    const { result } = renderHook(() => useTurnStream("t-1"));

    act(() => {
      source().emitRaw("content", "{not json", 1);
      source().emit("content", { type: "content", content: "fine", seq: 2 }, 2);
    });

    await waitFor(() => expect(result.current.answer).toBe("fine"));
    expect(result.current.finished).toBe(false);
  });
});

describe("useTurnStream — staged capabilities (phase 9)", () => {
  it("records ended stages, capability notes and the result's metadata", async () => {
    const { result } = renderHook(() => useTurnStream("t-9"));

    act(() => {
      source().emit("stage_start", { type: "stage_start", stage: "gather", seq: 1 }, 1);
      source().emit(
        "observation",
        { type: "observation", stage: "gather", content: "no web search key is connected", seq: 2 },
        2,
      );
      // Bookkeeping, with metadata: not a sentence for the reader.
      source().emit(
        "observation",
        { type: "observation", stage: "synthesize", content: "saved", metadata: { note_saved: false }, seq: 3 },
        3,
      );
      source().emit("stage_end", { type: "stage_end", stage: "gather", seq: 4 }, 4);
      source().emit(
        "result",
        { type: "result", content: "# R", metadata: { report_id: "r1", kb_only: true }, seq: 5 },
        5,
      );
    });

    await waitFor(() => expect(result.current.resultMeta).toEqual({ report_id: "r1", kb_only: true }));
    expect(result.current.stagesDone).toEqual(["gather"]);
    expect(result.current.observations).toEqual(["no web search key is connected"]);
  });

  it("carries a url source's link through", async () => {
    const { result } = renderHook(() => useTurnStream("t-10"));
    act(() => {
      source().emit(
        "sources",
        {
          type: "sources",
          metadata: { sources: [{ kind: "url", id: "1", title: "P", url: "https://p.test/" }] },
          seq: 1,
        },
        1,
      );
    });
    await waitFor(() => expect(result.current.sources[0]?.url).toBe("https://p.test/"));
  });
});
