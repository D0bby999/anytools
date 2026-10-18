// @vitest-environment node
/**
 * bad-day-minimum-server.test.ts
 * up-methods phase 13, the server half of Home's "Today" block: which state it
 * reads, which fields leave the loader, and the "Low day" cookie — one local
 * day, one learner, no server state.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env.server", () => ({
  API_BASE: "http://api", API_TOKEN: "t", APP_URL: "http://app.test", SESSION_SECRET: "s".repeat(32), useSecureCookies: false,
}));
const requireUser = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireUser: (r: Request) => requireUser(r) }));
const apiFetch = vi.fn();
vi.mock("~/lib/api.server", async (orig) => ({ ...(await orig<object>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const home = await import("~/routes/home");
const lowDayRoute = await import("~/routes/app.api.low-day");
const { localDay } = await import("~/lib/local-day");

const state = (over: Record<string, unknown> = {}) => ({
  id: "st-1",
  goal: "Read Vietnamese news",
  real_scenario: "",
  outcome_12w: "",
  next_task: "Read a full article",
  next_task_minimum: "Read one headline",
  handover_md: "HANDOVER-MARKER",
  minimum_contract: {
    downshift_when: "Under five hours of sleep",
    still_worth_keeping: "One headline keeps the habit alive",
    ask_for_help_when: "HELP-MARKER-91b2",
  },
  ...over,
});

let states: unknown[] = [];

beforeEach(() => {
  states = [state(), state({ id: "st-2", next_task: "Older goal's task" })];
  requireUser.mockReset().mockResolvedValue({ userId: "user-1", user: { id: "user-1", timezone: "Asia/Ho_Chi_Minh" } });
  apiFetch.mockReset().mockImplementation(async (path: string) => {
    if (path === "/v1/learning/states") return { states };
    throw new Error("not under test");
  });
});

function homeArgs(cookie?: string) {
  const headers = cookie ? { Cookie: cookie } : undefined;
  return { request: new Request("http://app.test/", { headers }), params: {} } as unknown as Parameters<
    typeof home.loader
  >[0];
}

async function toggle(on: boolean): Promise<string> {
  const form = new FormData();
  form.set("on", on ? "1" : "0");
  const res = (await lowDayRoute.action({
    request: new Request("http://app.test/app/api/low-day", { method: "POST", body: form }),
    params: {},
  } as unknown as Parameters<typeof lowDayRoute.action>[0])) as Response;
  const set = res.headers.get("Set-Cookie") ?? "";
  return set.split(";")[0] ?? "";
}

describe("Home's Today loader", () => {
  it("reads the most recently updated state, and only the fields the block shows", async () => {
    const data = await home.loader(homeArgs());
    expect(data.today).toEqual({
      id: "st-1",
      goal: "Read Vietnamese news",
      next_task: "Read a full article",
      next_task_minimum: "Read one headline",
      still_worth_keeping: "One headline keeps the habit alive",
    });
    expect(JSON.stringify(data)).not.toContain("HELP-MARKER");
    expect(JSON.stringify(data)).not.toContain("HANDOVER-MARKER");
    expect(data.lowDay).toBe(false);
  });

  it("has no block without a learning state", async () => {
    states = [];
    const data = await home.loader(homeArgs());
    expect(data.today).toBeNull();
    expect(data.lowDay).toBe(false);
  });

  it("has no block when the states cannot be read", async () => {
    apiFetch.mockImplementation(async () => {
      throw new Error("down");
    });
    expect((await home.loader(homeArgs())).today).toBeNull();
  });
});

describe("the Low day switch", () => {
  it("is on for the learner's local day once turned on, and off once turned off", async () => {
    const on = await toggle(true);
    expect(on).toMatch(/^__anytools_low_day=/);
    expect((await home.loader(homeArgs(on))).lowDay).toBe(true);
    const off = await toggle(false);
    expect((await home.loader(homeArgs(off))).lowDay).toBe(false);
  });

  it("does not carry over to the next local day", async () => {
    const on = await toggle(true);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
      expect((await home.loader(homeArgs(on))).lowDay).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("belongs to the learner who turned it on", async () => {
    const on = await toggle(true);
    requireUser.mockResolvedValue({ userId: "user-2", user: { id: "user-2", timezone: "Asia/Ho_Chi_Minh" } });
    expect((await home.loader(homeArgs(on))).lowDay).toBe(false);
  });

  it("stores nothing on the server", async () => {
    await toggle(true);
    await toggle(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("localDay", () => {
  it("is the learner's calendar day, not the server's", () => {
    const at = new Date("2026-10-16T20:00:00Z");
    expect(localDay("Asia/Ho_Chi_Minh", at)).toBe("2026-10-17");
    expect(localDay("America/Los_Angeles", at)).toBe("2026-10-16");
  });

  it("falls back to UTC for a zone it does not know", () => {
    expect(localDay("Not/AZone", new Date("2026-10-16T23:30:00Z"))).toBe("2026-10-16");
  });
});
