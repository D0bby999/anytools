// @vitest-environment node
/**
 * own-version-actions.test.ts
 * "Write your own version first" (up-methods phase 11) on the server side of
 * the web app: the actions forward the three lines to the API exactly as
 * written, send none when none were written, save the retell under the named
 * answer, and store the Settings switch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env.server", () => ({
  API_BASE: "http://api", API_TOKEN: "t", APP_URL: "http://app.test", SESSION_SECRET: "s".repeat(32), useSecureCookies: false,
}));
const requireUser = vi.fn();
const requireUserId = vi.fn();
vi.mock("~/lib/auth.server", () => ({
  requireUser: (r: Request) => requireUser(r),
  requireUserId: (r: Request) => requireUserId(r),
}));
const apiFetch = vi.fn();
vi.mock("~/lib/api.server", async (orig) => ({ ...(await orig<object>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const chat = await import("~/routes/chat.$sessionId");
const solve = await import("~/routes/solve");
const retell = await import("~/routes/app.api.retell");
const settings = await import("~/routes/settings.account");
const { ApiError } = await import("~/lib/api.server");

const SESSION = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "22222222-2222-4222-8222-222222222222";
const LINES = { understanding: "u", uncertain: "n", proof: "p" };

function post(url: string, fields: Record<string, string>, params: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return { request: new Request(url, { method: "POST", body: form }), params, context: {} } as never;
}

const withLines = { own_understanding: "u", own_uncertain: "n", own_proof: "p" };

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ userId: "user-1", user: { id: "user-1", email: "a@b.c" } });
  requireUserId.mockReset().mockResolvedValue("user-1");
  apiFetch.mockReset().mockResolvedValue({ turn_id: "t1", session_id: SESSION, status: "queued" });
});

describe("chat", () => {
  it("forwards the three lines with the message", async () => {
    await chat.action(post("http://app.test/chat/x", { intent: "send", message: "Why?", ...withLines }, { sessionId: SESSION }));
    expect(apiFetch).toHaveBeenCalledWith(`/v1/chat/sessions/${SESSION}/turns`, "user-1", {
      method: "POST",
      body: { message: "Why?", own_version: LINES },
    });
  });

  it("sends no own_version when none was written", async () => {
    await chat.action(post("http://app.test/chat/x", { intent: "send", message: "Why?" }, { sessionId: SESSION }));
    expect(apiFetch).toHaveBeenCalledWith(`/v1/chat/sessions/${SESSION}/turns`, "user-1", {
      method: "POST",
      body: { message: "Why?" },
    });
  });

  it("shows the API's refusal when the switch is on and the lines are missing", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(400, "write your own version first", "own_version_required"));
    const result = await chat.action(post("http://app.test/chat/x", { intent: "send", message: "Why?" }, { sessionId: SESSION }));
    expect(result).toEqual({ ok: false, error: "write your own version first" });
  });
});

describe("solve", () => {
  it("forwards the three lines with the problem", async () => {
    await solve.action(post("http://app.test/solve", { intent: "solve", problem: "2x+3=11", ...withLines }));
    const [path, , init] = apiFetch.mock.calls[0] as [string, string, { body: Record<string, unknown> }];
    expect(path).toBe("/v1/solve");
    expect(init.body.own_version).toEqual(LINES);
  });
});

describe("retell", () => {
  it("saves the retell under the named answer", async () => {
    apiFetch.mockResolvedValueOnce({ retell: { text: "mine", written_at: "2026-10-16T00:00:00Z" } });
    const result = await retell.action(post("http://app.test/app/api/retell", { messageId: MESSAGE, text: " mine " }));
    expect(apiFetch).toHaveBeenCalledWith(`/v1/chat/messages/${MESSAGE}/retell`, "user-1", {
      method: "POST",
      body: { text: "mine" },
    });
    expect(result).toEqual({ ok: true, retell: { text: "mine", written_at: "2026-10-16T00:00:00Z" } });
  });

  it("refuses an empty or over-long retell before the API", async () => {
    expect(await retell.action(post("http://app.test/app/api/retell", { messageId: MESSAGE, text: "  " }))).toMatchObject({ ok: false });
    expect(await retell.action(post("http://app.test/app/api/retell", { messageId: MESSAGE, text: "x".repeat(4001) }))).toMatchObject({ ok: false });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("a malformed message id is a 404, never an API path", async () => {
    await expect(retell.action(post("http://app.test/app/api/retell", { messageId: "../me", text: "x" }))).rejects.toBeInstanceOf(Response);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("settings", () => {
  it("stores the switch", async () => {
    const result = await settings.action(post("http://app.test/settings/account", { intent: "own_version", enabled: "true" }));
    expect(apiFetch).toHaveBeenCalledWith("/v1/me/own-version-first", "user-1", { method: "PUT", body: { enabled: true } });
    expect(result).toMatchObject({ intent: "own_version", saved: true });
    expect(apiFetch).not.toHaveBeenCalledWith("/v1/me", "user-1", { method: "DELETE" });
  });

  it("turns it off", async () => {
    await settings.action(post("http://app.test/settings/account", { intent: "own_version", enabled: "false" }));
    expect(apiFetch).toHaveBeenCalledWith("/v1/me/own-version-first", "user-1", { method: "PUT", body: { enabled: false } });
  });
});
