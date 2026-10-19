// @vitest-environment node
/**
 * reminders-route.test.ts
 * Settings → Reminders' action: each intent calls the one API route it
 * names, for the signed-in learner; a malformed subscription or hour never
 * reaches the API; and the API's refusals become the page's sentences.
 * Also the base64url decoding PushManager.subscribe needs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env.server", () => ({
  API_BASE: "http://api", API_TOKEN: "t", APP_URL: "http://app.test", SESSION_SECRET: "s".repeat(32), useSecureCookies: false,
}));
const requireUser = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireUser: (r: Request) => requireUser(r) }));
const apiFetch = vi.fn();
vi.mock("~/lib/api.server", async (orig) => ({ ...(await orig<object>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const route = await import("~/routes/settings.reminders");
const { ApiError } = await import("~/lib/api.server");
const { applicationServerKey } = await import("~/lib/pwa");

function post(fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return { request: new Request("http://app.test/settings/reminders", { method: "POST", body: form }), params: {} } as never;
}

const SUB = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } };

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ user: { id: "user-1", email: "a@b.c" } });
  apiFetch.mockReset().mockResolvedValue({ sent: 2 });
});

describe("the reminders action", () => {
  it("maps each intent to its route", async () => {
    await route.action(post({ intent: "hour", hour: "21" }));
    await route.action(post({ intent: "subscribe", subscription: JSON.stringify({ ...SUB, expirationTime: null }) }));
    await route.action(post({ intent: "unsubscribe", endpoint: SUB.endpoint }));
    expect(await route.action(post({ intent: "test" }))).toEqual({ intent: "test", ok: true, sent: 2 });
    expect(apiFetch.mock.calls).toEqual([
      ["/v1/push/settings", "user-1", { method: "PUT", body: { hour: 21 } }],
      ["/v1/push/subscriptions", "user-1", { method: "POST", body: SUB }],
      ["/v1/push/subscriptions", "user-1", { method: "DELETE", body: { endpoint: SUB.endpoint } }],
      ["/v1/push/test", "user-1", { method: "POST" }],
    ]);
  });

  it("refuses an hour or a subscription that is not one, without calling the API", async () => {
    for (const hour of ["24", "-1", "7.5", "seven"]) {
      expect(await route.action(post({ intent: "hour", hour }))).toEqual({ intent: "hour", errorKey: "reminders.errors.generic" });
    }
    for (const subscription of ["{", "{}", JSON.stringify({ endpoint: SUB.endpoint }), "x".repeat(5000)]) {
      expect(await route.action(post({ intent: "subscribe", subscription }))).toEqual({
        intent: "subscribe",
        errorKey: "reminders.errors.subscribe",
      });
    }
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("words the API's refusals and rethrows the rest", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(400, "not a browser push service", "bad_request"));
    expect(await route.action(post({ intent: "subscribe", subscription: JSON.stringify(SUB) }))).toEqual({
      intent: "subscribe",
      errorKey: "reminders.errors.subscribe",
    });
    apiFetch.mockRejectedValueOnce(new ApiError(500, "boom", "internal"));
    await expect(route.action(post({ intent: "test" }))).rejects.toBeInstanceOf(ApiError);
  });
});

describe("applicationServerKey", () => {
  it("decodes base64url without padding", () => {
    // 65 bytes: 0x04 then 64 bytes, as a P-256 public key is.
    const bytes = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : i));
    const b64url = Buffer.from(bytes).toString("base64url");
    expect(b64url).not.toContain("=");
    expect(Array.from(applicationServerKey(b64url))).toEqual(Array.from(bytes));
  });
});
