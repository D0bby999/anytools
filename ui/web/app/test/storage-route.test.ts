// @vitest-environment node
/**
 * storage-route.test.ts
 * Settings → Storage's action and "Save to my Drive"'s resource route: each
 * intent calls the one API route it names, for the signed-in learner, and
 * the API's refusals become the page's sentences rather than a 500.
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

const route = await import("~/routes/storage");
const oldRoute = await import("~/routes/settings.storage");
const save = await import("~/routes/app.api.save-to-drive");
const { ApiError } = await import("~/lib/api.server");

function post(url: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return { request: new Request(url, { method: "POST", body: form }), params: {} } as never;
}

const ID = "8b0d3c4e-2f1a-4b5c-9d6e-7f8a9b0c1d2e";

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ user: { id: "user-1", email: "a@b.c" } });
  requireUserId.mockReset().mockResolvedValue("user-1");
  apiFetch.mockReset().mockResolvedValue({});
});

describe("the storage action", () => {
  it("maps each intent to its route", async () => {
    await route.action(post("http://app.test/storage", { intent: "choose", storage: "drive" }));
    await route.action(post("http://app.test/storage", { intent: "move" }));
    await route.action(post("http://app.test/storage", { intent: "cancel" }));
    expect(apiFetch.mock.calls).toEqual([
      ["/v1/me/file-storage", "user-1", { method: "PUT", body: { storage: "drive" } }],
      ["/v1/me/file-storage/move", "user-1", { method: "POST" }],
      ["/v1/me/file-storage/move/cancel", "user-1", { method: "POST" }],
    ]);
  });

  it("refuses a choice that is neither place without calling the API", async () => {
    expect(await route.action(post("http://app.test/storage", { intent: "choose", storage: "dropbox" }))).toEqual({
      intent: "choose",
      errorKey: "errors.generic",
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("words the API's refusals", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(409, "connect", "drive_not_connected"));
    expect(await route.action(post("http://app.test/storage", { intent: "choose", storage: "drive" }))).toEqual({
      intent: "choose",
      errorKey: "errors.notConnected",
    });
    apiFetch.mockRejectedValueOnce(new ApiError(409, "running", "move_running"));
    expect(await route.action(post("http://app.test/storage", { intent: "move" }))).toEqual({
      intent: "move",
      errorKey: "errors.running",
    });
    apiFetch.mockRejectedValueOnce(new ApiError(409, "full", "drive_full"));
    expect(await route.action(post("http://app.test/storage", { intent: "choose", storage: "drive" }))).toEqual({
      intent: "choose",
      errorKey: "errors.full",
    });
  });

  it("reports nothing to move", async () => {
    apiFetch.mockResolvedValueOnce({ move: null, nothing_to_move: true });
    expect(await route.action(post("http://app.test/storage", { intent: "move" }))).toEqual({
      intent: "move",
      ok: true,
      nothing: true,
    });
  });
});

describe("save to my Drive", () => {
  it("calls each kind's own route", async () => {
    apiFetch.mockResolvedValue({ file_id: "f", name: "x.md", url: "https://drive.google.com/file/d/f/view" });
    for (const [kind, extra] of [["worksheet", {}], ["book", {}], ["notebook", {}], ["study_notes", { language: "vi" }]] as const) {
      await save.action(post("http://app.test/app/api/save-to-drive", { kind, id: ID, ...extra }));
    }
    expect(apiFetch.mock.calls.map((c) => c[0])).toEqual([
      `/v1/worksheets/${ID}/export/drive`,
      `/v1/books/${ID}/export/drive`,
      `/v1/notebooks/${ID}/export/drive`,
      `/v1/documents/${ID}/study-notes/export/drive?language=vi`,
    ]);
    expect(apiFetch.mock.calls.every((c) => c[1] === "user-1" && (c[2] as { method: string }).method === "POST")).toBe(true);
  });

  it("refuses an unknown kind or a malformed id before the API", async () => {
    expect(await save.action(post("http://app.test/app/api/save-to-drive", { kind: "account", id: ID }))).toEqual({
      ok: false,
      errorKey: "export.failed",
    });
    await expect(save.action(post("http://app.test/app/api/save-to-drive", { kind: "book", id: "../x" }))).rejects.toBeInstanceOf(Response);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("words the API's refusals", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(409, "off", "drive_storage_off"));
    expect(await save.action(post("http://app.test/app/api/save-to-drive", { kind: "book", id: ID }))).toEqual({
      ok: false,
      errorKey: "export.storageOff",
    });
    apiFetch.mockRejectedValueOnce(new ApiError(404, "not found", "not_found"));
    expect(await save.action(post("http://app.test/app/api/save-to-drive", { kind: "book", id: ID }))).toEqual({
      ok: false,
      errorKey: "export.failed",
    });
  });
});

describe("the old Settings → Storage address", () => {
  it("redirects to /storage, keeping the query string Drive returns with", () => {
    const res = oldRoute.loader({ request: new Request("http://app.test/settings/storage?drive=connected") } as never) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/storage?drive=connected");
  });
});
