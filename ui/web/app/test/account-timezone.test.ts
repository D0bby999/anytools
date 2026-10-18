// @vitest-environment node
/**
 * account-timezone.test.ts
 * The learner's zone: the shell's automatic report never overwrites a choice
 * (only_if_unset), Settings does, and an unknown zone is a message, not a 500.
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

const settings = await import("~/routes/settings.account");
const report = await import("~/routes/app.api.timezone");
const { ApiError } = await import("~/lib/api.server");

function post(url: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return { request: new Request(url, { method: "POST", body: form }), params: {} };
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ user: { id: "user-1", email: "a@b.c" } });
  requireUserId.mockReset().mockResolvedValue("user-1");
  apiFetch.mockReset().mockResolvedValue({ timezone: "Asia/Ho_Chi_Minh", changed: true });
});

describe("time zone", () => {
  it("the shell's report never overwrites a zone the learner chose", async () => {
    const res = await report.action(
      post("http://app.test/app/api/timezone", { timezone: "Asia/Ho_Chi_Minh" }) as unknown as Parameters<typeof report.action>[0],
    );
    expect(res.status).toBe(200);
    expect(apiFetch).toHaveBeenCalledWith("/v1/me/timezone", "user-1", {
      method: "PUT",
      body: { timezone: "Asia/Ho_Chi_Minh", only_if_unset: true },
    });
  });

  it("Settings saves the learner's choice over any earlier one", async () => {
    const result = await settings.action(
      post("http://app.test/settings/account", { intent: "timezone", timezone: " Europe/Berlin " }) as unknown as Parameters<
        typeof settings.action
      >[0],
    );
    expect(result).toMatchObject({ intent: "timezone", saved: true });
    expect(apiFetch).toHaveBeenCalledWith("/v1/me/timezone", "user-1", {
      method: "PUT",
      body: { timezone: "Europe/Berlin", only_if_unset: false },
    });
  });

  it("an unknown zone is a message, and never deletes anything", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(400, "unknown time zone", "bad_timezone"));
    const result = await settings.action(
      post("http://app.test/settings/account", { intent: "timezone", timezone: "Mars/Olympus" }) as unknown as Parameters<
        typeof settings.action
      >[0],
    );
    expect(result).toMatchObject({ intent: "timezone", errorKey: "settings.account.zoneInvalid" });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).not.toHaveBeenCalledWith("/v1/me", "user-1", { method: "DELETE" });
  });
});
