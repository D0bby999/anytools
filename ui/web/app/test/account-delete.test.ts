// @vitest-environment node
/**
 * account-delete.test.ts
 * Deleting an account needs the email typed back, calls the API as the signed-in
 * user only, and ends the session afterwards.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env.server", () => ({
  API_BASE: "http://api", API_TOKEN: "t", APP_URL: "http://app.test", SESSION_SECRET: "s".repeat(32), useSecureCookies: false,
}));
const requireUser = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireUser: (r: Request) => requireUser(r) }));
const apiFetch = vi.fn();
vi.mock("~/lib/api.server", async (orig) => ({ ...(await orig<object>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const { action } = await import("~/routes/settings.account");

function submit(confirm: string) {
  const form = new FormData();
  form.set("confirm", confirm);
  const args = { request: new Request("http://app.test/settings/account", { method: "POST", body: form }), params: {} };
  return action(args as unknown as Parameters<typeof action>[0]);
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ user: { id: "user-1", email: "Ada@Example.com" } });
  apiFetch.mockReset().mockResolvedValue(undefined);
});

describe("delete account", () => {
  it("refuses without the account's email and never calls the API", async () => {
    expect(await submit("someone@else.com")).toMatchObject({ errorKey: "settings.account.mismatch" });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("deletes as the signed-in user and clears the session cookie", async () => {
    const res = (await submit(" ada@example.com ")) as Response;
    expect(apiFetch).toHaveBeenCalledWith("/v1/me", "user-1", { method: "DELETE" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
    expect(res.headers.get("Set-Cookie")).toMatch(/__anytools_session=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/);
  });
});
