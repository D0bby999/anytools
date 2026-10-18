// @vitest-environment node
/**
 * session-watermark.test.ts — security audit F-4.
 * A cookie minted before the account's watermark is refused; signing out
 * moves the watermark; an API blip does not forget a watermark already known.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env.server", () => ({ API_BASE: "http://api", API_TOKEN: "t" }));
const apiFetch = vi.fn();
vi.mock("~/lib/api.server", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const wm = await import("~/lib/session-watermark.server");

beforeEach(() => {
  apiFetch.mockReset();
  wm.__clearWatermarkCacheForTests();
});

describe("session watermark", () => {
  it("refuses a cookie minted before the watermark and admits one minted after", async () => {
    apiFetch.mockResolvedValue({ sessions_valid_after: 1_000 });
    expect(await wm.isSessionRevoked("u1", 900)).toBe(true);
    expect(await wm.isSessionRevoked("u1", 1_100)).toBe(false);
  });

  it("keeps a known watermark when the API is briefly unreachable", async () => {
    apiFetch.mockResolvedValueOnce({ sessions_valid_after: 1_000 });
    expect(await wm.isSessionRevoked("u1", 900)).toBe(true);
    wm.invalidateWatermark("u1"); // force a re-read…
    apiFetch.mockResolvedValueOnce({ sessions_valid_after: 1_000 });
    await wm.isSessionRevoked("u1", 900);
    // …then expire the cache entry and fail the next read.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 120_000);
    apiFetch.mockRejectedValueOnce(new Error("503"));
    expect(await wm.isSessionRevoked("u1", 900)).toBe(true);
    vi.useRealTimers();
  });

  it("revokeSessions posts the bump for that user", async () => {
    apiFetch.mockResolvedValue({ sessions_valid_after: 2_000 });
    await wm.revokeSessions("u1");
    expect(apiFetch).toHaveBeenCalledWith("/v1/auth/session-watermark", "u1", { method: "POST", body: {} });
  });
});
