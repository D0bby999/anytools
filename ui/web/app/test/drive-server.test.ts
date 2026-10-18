// @vitest-environment node
/**
 * drive-server.test.ts
 *
 * The BFF half of "when Drive is not configured, the Drive UI is absent":
 * `loadDrive` is the one function every page asks, and it must answer null
 * for EITHER side being unconfigured — and throw, not hide, when the API is
 * merely down. Plus the Drive intents on the two routes that carry them, with
 * only the API modules mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = {
  configured: true,
};
vi.mock("~/lib/env.server", () => ({
  API_BASE: "http://api.internal:8080",
  API_TOKEN: "gateway-token",
  isProduction: false,
  GOOGLE_API_KEY: "browser-api-key",
  GOOGLE_PICKER_APP_ID: "123456789012",
  driveConfigured: () => env.configured,
}));

const requireUser = vi.fn();
const requireUserId = vi.fn();
vi.mock("~/lib/auth.server", () => ({
  requireUser: (request: Request) => requireUser(request),
  requireUserId: (request: Request) => requireUserId(request),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { loadDrive, parsePicked } = await import("~/lib/drive.server");
const { ApiError } = await import("~/lib/api.server");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const STATUS = { connected: true, configured: true, needs_reconnect: false, grants: 3, re_pick: 0, removed: 0 };

beforeEach(() => {
  env.configured = true;
  fetchMock.mockReset();
  requireUser.mockReset().mockResolvedValue({ user: { id: "user-1" } });
  requireUserId.mockReset().mockResolvedValue("user-1");
});

describe("loadDrive", () => {
  it("is null without asking the API when the BFF has no Picker configuration", async () => {
    env.configured = false;
    expect(await loadDrive("user-1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is null when the API never registered the Drive routes (404)", async () => {
    fetchMock.mockResolvedValue(json({ error: "not found", code: "not_found" }, 404));
    expect(await loadDrive("user-1")).toBeNull();
  });

  it("is null when the API says it has no Google client", async () => {
    fetchMock.mockResolvedValue(json({ ...STATUS, connected: false, configured: false }));
    expect(await loadDrive("user-1")).toBeNull();
  });

  it("returns the status and the Picker's browser values", async () => {
    fetchMock.mockResolvedValue(json(STATUS));
    const drive = await loadDrive("user-1");
    expect(drive).toEqual({ picker: { apiKey: "browser-api-key", appId: "123456789012" }, status: STATUS });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.internal:8080/v1/connectors/drive/status");
    expect((init.headers as Record<string, string>)["X-AnyTools-User-Id"]).toBe("user-1");
  });

  it("throws on an outage rather than passing it off as 'not configured'", async () => {
    fetchMock.mockResolvedValue(json({ error: "something went wrong" }, 500));
    await expect(loadDrive("user-1")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("parsePicked", () => {
  it("accepts {id, kind} pairs and drops everything else the browser sent", () => {
    expect(
      parsePicked(JSON.stringify([{ id: "1AbC-_x", kind: "folder", name: "ignored", url: "x" }])),
    ).toEqual([{ id: "1AbC-_x", kind: "folder" }]);
  });

  it.each([
    ["not json", "{"],
    ["an empty selection", "[]"],
    ["an object", JSON.stringify({ id: "a", kind: "file" })],
    ["an unknown kind", JSON.stringify([{ id: "a", kind: "shortcut" }])],
    ["a path in the id", JSON.stringify([{ id: "../../v1/byok", kind: "file" }])],
    ["a missing id", JSON.stringify([{ kind: "file" }])],
  ])("refuses %s", (_name, raw) => {
    expect(parsePicked(raw)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────── route intents

const { action: kbAction, loader: kbLoader } = await import("~/routes/knowledge.$kbId");
const { action: settingsAction } = await import("~/routes/settings.connections");
const { action: tokenAction } = await import("~/routes/app.api.drive.picker-token");

const KB_ID = "44444444-4444-4444-4444-444444444444";

type Result = Record<string, unknown> | null;

function post(fields: Record<string, string>, url = `http://app.test/knowledge/${KB_ID}`) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request(url, { method: "POST", body: form });
}

function kbSubmit(fields: Record<string, string>): Promise<Result> {
  const args = { request: post(fields), params: { kbId: KB_ID } };
  return kbAction(args as unknown as Parameters<typeof kbAction>[0]) as Promise<Result>;
}

/** Routes the mocked fetch by path, so one test can script several calls. */
function api(routes: Record<string, () => Response>) {
  fetchMock.mockImplementation(async (url: string) => {
    const path = new URL(url).pathname;
    const handler = routes[path];
    if (!handler) throw new Error(`unexpected API call ${path}`);
    return handler();
  });
}

describe("knowledge base: drive-import", () => {
  it("forwards only the validated pairs and returns the per-item report", async () => {
    const report = { kb_id: KB_ID, imported: 2, failed: 0, items: [] };
    api({ [`/v1/kb/${KB_ID}/drive/import`]: () => json(report) });

    const result = await kbSubmit({
      intent: "drive-import",
      picked: JSON.stringify([{ id: "fld1", kind: "folder", name: "x" }]),
    });

    expect(result).toEqual({ driveReport: report });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ picked: [{ id: "fld1", kind: "folder" }] });
  });

  it("refuses a malformed selection without calling the API", async () => {
    const result = await kbSubmit({ intent: "drive-import", picked: "[]" });
    expect(result).toMatchObject({ driveErrorKey: "drive.errors.badSelection" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns needs_reconnect into the reconnect sentence, beside the button", async () => {
    api({
      [`/v1/kb/${KB_ID}/drive/import`]: () =>
        json({ error: "Google Drive needs to be reconnected", code: "needs_reconnect" }, 409),
    });
    const result = await kbSubmit({ intent: "drive-import", picked: JSON.stringify([{ id: "a", kind: "file" }]) });
    expect(result).toMatchObject({ driveErrorKey: "drive.errors.reconnect" });
  });
});

describe("knowledge base: drive-sync", () => {
  it("returns the sync report", async () => {
    const report = { baselined: false, rebaselined: false, checked: 4, reimported: 1, re_pick: 0, removed: 0, failed: 0 };
    api({ "/v1/connectors/drive/sync": () => json(report) });
    expect(await kbSubmit({ intent: "drive-sync" })).toEqual({ syncReport: report });
  });

  it("returns a timeout beside the button instead of throwing", async () => {
    api({
      "/v1/connectors/drive/sync": () =>
        json({ error: "the sync is taking longer than expected", code: "timeout" }, 504),
    });
    expect(await kbSubmit({ intent: "drive-sync" })).toMatchObject({
      driveErrorKey: "drive.errors.syncFailed",
      driveErrorDetail: "the sync is taking longer than expected",
    });
  });
});

describe("knowledge base loader", () => {
  const kb = { id: KB_ID, name: "Course", embedding_model: "", dims: 0, needs_reembed: false };

  function load() {
    const args = { request: new Request(`http://app.test/knowledge/${KB_ID}`), params: { kbId: KB_ID } };
    return kbLoader(args as unknown as Parameters<typeof kbLoader>[0]);
  }

  it("carries the grants when Drive is available", async () => {
    const grants = [{ id: "g1", file_id: "f1", kind: "file", name: "a.md", state: "active" }];
    api({
      [`/v1/kb/${KB_ID}`]: () => json(kb),
      [`/v1/kb/${KB_ID}/documents`]: () => json({ documents: [] }),
      "/v1/connectors/drive/status": () => json(STATUS),
      [`/v1/kb/${KB_ID}/drive/grants`]: () => json({ grants }),
    });
    const data = await load();
    expect(data.drive?.status).toEqual(STATUS);
    expect(data.grants).toEqual(grants);
    expect(data.driveUnavailable).toBe(false);
  });

  it("has no Drive section at all on a deployment without Drive", async () => {
    env.configured = false;
    api({
      [`/v1/kb/${KB_ID}`]: () => json(kb),
      [`/v1/kb/${KB_ID}/documents`]: () => json({ documents: [] }),
    });
    const data = await load();
    expect(data.drive).toBeNull();
    expect(data.driveUnavailable).toBe(false);
  });

  it("keeps the documents when Drive's status fails, and says Drive is unavailable", async () => {
    api({
      [`/v1/kb/${KB_ID}`]: () => json(kb),
      [`/v1/kb/${KB_ID}/documents`]: () => json({ documents: [] }),
      "/v1/connectors/drive/status": () => json({ error: "boom" }, 500),
    });
    const data = await load();
    expect(data.kb).toEqual(kb);
    expect(data.drive).toBeNull();
    expect(data.driveUnavailable).toBe(true);
  });
});

describe("settings: drive-disconnect", () => {
  it("calls DELETE /v1/connectors/drive", async () => {
    api({ "/v1/connectors/drive": () => json({ connected: false }) });
    const args = { request: post({ intent: "drive-disconnect" }, "http://app.test/settings"), params: {} };
    const result = await settingsAction(args as unknown as Parameters<typeof settingsAction>[0]);
    expect((result as { data: unknown }).data).toEqual({ ok: true, message: null });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("DELETE");
  });
});

describe("picker-token route", () => {
  function call() {
    const args = { request: new Request("http://app.test/app/api/drive/picker-token", { method: "POST" }), params: {} };
    return tokenAction(args as unknown as Parameters<typeof tokenAction>[0]);
  }

  it("answers the access token, no-store", async () => {
    api({ "/v1/connectors/drive/picker-token": () => json({ access_token: "ya29.picker" }) });
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ access_token: "ya29.picker" });
  });

  it("passes the API's code through so the page can say 'reconnect'", async () => {
    api({
      "/v1/connectors/drive/picker-token": () =>
        json({ error: "Google Drive needs to be reconnected", code: "needs_reconnect" }, 409),
    });
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "needs_reconnect" });
  });
});
