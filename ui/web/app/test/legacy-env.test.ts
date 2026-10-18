/**
 * legacy-env.test.ts
 *
 * anytools-merge phase 1: for one release the BFF still accepts a LONGPLAY_*
 * variable when its ANYTOOLS_* twin is unset or empty, and never when the twin
 * is set.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("env.server legacy LONGPLAY_* fallback", () => {
  it("reads the old name when the new one is unset", async () => {
    vi.stubEnv("ANYTOOLS_APP_URL", "");
    vi.stubEnv("LONGPLAY_APP_URL", "https://old.example/");
    const { APP_URL } = await import("~/lib/env.server");
    expect(APP_URL).toBe("https://old.example");
  });

  it("prefers the new name when both are set", async () => {
    vi.stubEnv("ANYTOOLS_APP_URL", "https://anytools.example");
    vi.stubEnv("LONGPLAY_APP_URL", "https://old.example");
    const { APP_URL } = await import("~/lib/env.server");
    expect(APP_URL).toBe("https://anytools.example");
  });

  it("falls back only for ANYTOOLS_ names", async () => {
    vi.stubEnv("LONGPLAY_OTHER", "x");
    const { env } = await import("~/lib/env.server");
    expect(env("OTHER")).toBeUndefined();
    expect(env("ANYTOOLS_OTHER")).toBe("x");
  });
});
