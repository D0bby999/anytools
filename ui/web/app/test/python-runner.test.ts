/**
 * python-runner.test.ts
 * A run that failed in the worker (Python out of memory, a stack overflow)
 * leaves that worker unable to load Python again, its fetch being cut off:
 * the next run gets a new worker (independent review, M12).
 */
import { describe, expect, it, vi } from "vitest";

const workers: FakeWorker[] = [];
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  constructor() {
    workers.push(this);
  }
  postMessage(m: { id?: number }) {
    if (m.id === undefined) return;
    const reply = workers.length === 1 ? { kind: "failed", id: m.id, message: "RangeError" } : { kind: "result", id: m.id, result: { error: "", output: "", results: [] } };
    queueMicrotask(() => this.onmessage?.({ data: reply } as MessageEvent));
  }
  terminate() {
    this.terminated = true;
  }
}
vi.stubGlobal("Worker", FakeWorker);

const { runPython } = await import("~/lib/python-runner");

describe("a failed run", () => {
  it("ends its worker, and the next run starts a new one", async () => {
    expect(await runPython("x", "t", "m")).toEqual({ kind: "failed", message: "RangeError" });
    expect(workers[0]!.terminated).toBe(true);
    expect((await runPython("x", "t", "m")).kind).toBe("result");
    expect(workers).toHaveLength(2);
  });
});
