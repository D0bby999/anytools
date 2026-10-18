// @vitest-environment node
/**
 * profile-route.test.ts
 * Settings → Learning profile's action: each intent calls the one API route
 * it names, for the signed-in learner, and the API's refusals become the
 * page's sentences rather than a 500.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env.server", () => ({
  API_BASE: "http://api", API_TOKEN: "t", APP_URL: "http://app.test", SESSION_SECRET: "s".repeat(32), useSecureCookies: false,
}));
const requireUser = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireUser: (r: Request) => requireUser(r) }));
const apiFetch = vi.fn();
vi.mock("~/lib/api.server", async (orig) => ({ ...(await orig<object>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const route = await import("~/routes/settings.profile");
const { ApiError } = await import("~/lib/api.server");

function post(fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return {
    request: new Request("http://app.test/settings/profile", { method: "POST", body: form }),
    params: {},
  } as unknown as Parameters<typeof route.action>[0];
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ user: { id: "user-1", email: "a@b.c" } });
  apiFetch.mockReset().mockResolvedValue({});
});

describe("the profile action", () => {
  it("maps each intent to its route", async () => {
    await route.action(post({ intent: "add", section: "preferences", text: "Examples first.", kb_id: "" }));
    await route.action(post({ intent: "add", section: "struggles", text: "Recall.", kb_id: "kb-1" }));
    await route.action(post({ intent: "edit", id: "e 1", section: "struggles", text: "Recall slips.", kb_id: "" }));
    await route.action(post({ intent: "delete", id: "e-1" }));
    await route.action(post({ intent: "accept", id: "p-1" }));
    await route.action(post({ intent: "reject", id: "p-1" }));
    await route.action(post({ intent: "consolidation", on: "true" }));
    await route.action(post({ intent: "clear" }));
    expect(apiFetch.mock.calls).toEqual([
      ["/v1/profile/entries", "user-1", { method: "POST", body: { section: "preferences", text: "Examples first." } }],
      ["/v1/profile/entries", "user-1", { method: "POST", body: { section: "struggles", text: "Recall.", kb_id: "kb-1" } }],
      ["/v1/profile/entries/e%201", "user-1", { method: "PATCH", body: { section: "struggles", text: "Recall slips.", kb_id: "" } }],
      ["/v1/profile/entries/e-1", "user-1", { method: "DELETE" }],
      ["/v1/profile/entries/p-1/accept", "user-1", { method: "POST" }],
      ["/v1/profile/entries/p-1/reject", "user-1", { method: "POST" }],
      ["/v1/profile/settings", "user-1", { method: "PUT", body: { consolidation: true } }],
      ["/v1/profile", "user-1", { method: "DELETE" }],
    ]);
  });

  it("words the API's refusals", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(409, "full", "section_full"));
    expect(await route.action(post({ intent: "add", section: "preferences", text: "x" }))).toEqual({ errorKey: "errors.full" });
    apiFetch.mockRejectedValueOnce(new ApiError(409, "changed", "conflict"));
    expect(await route.action(post({ intent: "accept", id: "p" }))).toEqual({ errorKey: "errors.conflict" });
    apiFetch.mockRejectedValueOnce(new ApiError(400, "too long", "bad_request"));
    expect(await route.action(post({ intent: "edit", id: "e", section: "struggles", text: "x" }))).toEqual({ errorKey: "errors.invalid" });
    apiFetch.mockRejectedValueOnce(new ApiError(404, "not found", "not_found"));
    expect(await route.action(post({ intent: "delete", id: "e" }))).toEqual({ errorKey: "errors.generic" });
  });

  it("refuses an unknown section or intent without calling the API", async () => {
    expect(await route.action(post({ intent: "add", section: "secrets", text: "x" }))).toEqual({ errorKey: "errors.invalid" });
    expect(await route.action(post({ intent: "export" }))).toEqual({ errorKey: "errors.generic" });
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
