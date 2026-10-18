// @vitest-environment node
/**
 * cycle-close-actions.test.ts
 * Up-methods phase 10, server side. "Close this cycle" starts a cycle_close
 * naming THIS cycle, or opens the one it already has; "Use for week 1" writes
 * the last close's next step into week 1 through the cycle PATCH, looked up
 * again on the server and only while week 1 is empty.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env.server", () => ({ API_BASE: "http://api.internal:8080", API_TOKEN: "t", isProduction: false }));
const requireUser = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireUser: (r: Request) => requireUser(r) }));
const loop = { getCycle: vi.fn(), patchCycle: vi.fn() };
vi.mock("~/lib/loop.server", () => loop);
const sheets = { createWorksheet: vi.fn(), cycleCloses: vi.fn() };
vi.mock("~/lib/worksheets.server", () => sheets);

const { action, loader } = await import("~/routes/loop.cycle.$id");
const { ApiError } = await import("~/lib/api.server");

const CYCLE = "22222222-2222-4222-8222-222222222222";

function submit(fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const args = {
    request: new Request(`http://app.test/loop/cycle/${CYCLE}`, { method: "POST", body: form }),
    params: { id: CYCLE },
  };
  return action(args as unknown as Parameters<typeof action>[0]) as Promise<unknown>;
}

const previous = {
  id: "ws-last",
  title: "Last close",
  offers: [
    { row: 0, result: "Explaining", destination: "continue", next_step: "Explain to a new client" },
    { row: 3, result: "Calls", destination: "transfer", next_step: "Answer questions I cannot predict" },
  ],
  reduce_first: [],
};

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ user: { id: "user-1" } });
  for (const fn of [...Object.values(loop), ...Object.values(sheets)]) fn.mockReset();
});

describe("Close this cycle", () => {
  it("creates the close of THIS cycle and opens it", async () => {
    sheets.createWorksheet.mockResolvedValue({ id: "ws-new" });
    const out = (await submit({ intent: "close-cycle", title: "Cycle close: Explain", cycle_id: "someone-elses" })) as Response;
    expect(sheets.createWorksheet).toHaveBeenCalledWith("user-1", {
      kind: "cycle_close",
      title: "Cycle close: Explain",
      cycle_id: CYCLE,
    });
    expect(out.status).toBe(302);
    expect(out.headers.get("Location")).toBe("/toolkit/ws-new");
  });

  it("opens the cycle's existing close when it already has one", async () => {
    sheets.createWorksheet.mockRejectedValue(new ApiError(409, "this cycle already has a close", "cycle_closed"));
    sheets.cycleCloses.mockResolvedValue({ close: { id: "ws-old" }, previous: null });
    const out = (await submit({ intent: "close-cycle", title: "t" })) as Response;
    expect(sheets.cycleCloses).toHaveBeenCalledWith("user-1", CYCLE);
    expect(out.headers.get("Location")).toBe("/toolkit/ws-old");
  });
});

describe("Use for week 1", () => {
  it("writes the chosen row's next step into week 1, keeping the other weeks", async () => {
    loop.getCycle.mockResolvedValue({
      weekly_questions: [
        { question: "", capacity: "reduced" },
        { question: "Week two", capacity: "full" },
      ],
    });
    sheets.cycleCloses.mockResolvedValue({ close: null, previous });
    loop.patchCycle.mockResolvedValue({});
    expect(await submit({ intent: "from-close", row: "3", question: "posted text is ignored" })).toEqual({ ok: true });
    expect(loop.patchCycle).toHaveBeenCalledWith("user-1", CYCLE, {
      weekly_questions: [
        { question: "Answer questions I cannot predict", capacity: "reduced" },
        { question: "Week two", capacity: "full" },
      ],
    });
  });

  it("refuses a row the last close does not offer, and a week 1 already written", async () => {
    sheets.cycleCloses.mockResolvedValue({ close: null, previous });
    loop.getCycle.mockResolvedValue({ weekly_questions: [] });
    expect(await submit({ intent: "from-close", row: "1" })).toEqual({ errorKey: "cycleClose.gone" });
    loop.getCycle.mockResolvedValue({ weekly_questions: [{ question: "Mine", capacity: "full" }] });
    expect(await submit({ intent: "from-close", row: "0" })).toEqual({ errorKey: "cycleClose.weekOneTaken" });
    expect(loop.patchCycle).not.toHaveBeenCalled();
  });
});

describe("the cycle's page", () => {
  it("loads the cycle with its closes, and still loads when they cannot be read", async () => {
    loop.getCycle.mockResolvedValue({ id: CYCLE, day: 84 });
    sheets.cycleCloses.mockResolvedValue({ close: null, previous });
    const args = { request: new Request(`http://app.test/loop/cycle/${CYCLE}`), params: { id: CYCLE } };
    const run = () => loader(args as unknown as Parameters<typeof loader>[0]);
    expect(await run()).toEqual({ id: CYCLE, day: 84, closes: { close: null, previous } });
    sheets.cycleCloses.mockRejectedValue(new ApiError(500, "down", "internal"));
    expect(await run()).toEqual({ id: CYCLE, day: 84, closes: { close: null, previous: null } });
  });
});
