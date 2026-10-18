// @vitest-environment node
/**
 * local-signin.test.ts — the development-only sign-in is offered only on a
 * localhost http app URL with ANYTOOLS_DEV_LOGIN=1, and 404s otherwise.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("~/lib/env.server");
}

afterEach(() => vi.unstubAllEnvs());

describe("localSignInEnabled", () => {
  it("is on only for ANYTOOLS_DEV_LOGIN=1 on http localhost", async () => {
    expect((await load({ ANYTOOLS_DEV_LOGIN: "1", ANYTOOLS_APP_URL: "http://localhost:3000" })).localSignInEnabled()).toBe(true);
    expect((await load({ ANYTOOLS_DEV_LOGIN: "1", ANYTOOLS_APP_URL: "http://127.0.0.1:3000" })).localSignInEnabled()).toBe(true);
  });

  it("is off without the flag, on https, or on any other host", async () => {
    expect((await load({ ANYTOOLS_DEV_LOGIN: "", ANYTOOLS_APP_URL: "http://localhost:3000" })).localSignInEnabled()).toBe(false);
    expect((await load({ ANYTOOLS_DEV_LOGIN: "1", ANYTOOLS_APP_URL: "https://learn.example.com" })).localSignInEnabled()).toBe(false);
    expect((await load({ ANYTOOLS_DEV_LOGIN: "1", ANYTOOLS_APP_URL: "http://localhost.evil.test" })).localSignInEnabled()).toBe(false);
    expect((await load({ ANYTOOLS_DEV_LOGIN: "1", ANYTOOLS_APP_URL: "https://localhost:3000" })).localSignInEnabled()).toBe(false);
  });

  it("the route 404s when disabled, before touching the API", async () => {
    vi.resetModules();
    vi.stubEnv("ANYTOOLS_DEV_LOGIN", "");
    const apiFetch = vi.fn();
    vi.doMock("~/lib/api.server", () => ({ apiFetch }));
    const { action } = await import("~/routes/auth.local");
    const res = await action({
      request: new Request("http://localhost:3000/auth/local", { method: "POST" }),
      params: {},
    } as unknown as Parameters<typeof action>[0]).catch((r: unknown) => r);
    expect((res as Response).status).toBe(404);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
