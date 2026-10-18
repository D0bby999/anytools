/**
 * google-picker.test.ts
 *
 * The Picker loader's two promises: the Google script is added to the page
 * once, however many times "Pick more" is pressed — and a FAILED load is not
 * remembered, so a blocked request is retryable by clicking again rather than
 * broken until a reload.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

type W = Window & { gapi?: unknown; google?: unknown };

function gapiScripts() {
  return document.head.querySelectorAll('script[src="https://apis.google.com/js/api.js"]');
}

afterEach(() => {
  document.head.innerHTML = "";
  delete (window as W).gapi;
  delete (window as W).google;
  vi.resetModules();
});

describe("loadPicker", () => {
  it("adds the script once and shares the load", async () => {
    const { loadPicker } = await import("~/lib/google-picker.client");

    const first = loadPicker();
    const second = loadPicker();
    expect(gapiScripts()).toHaveLength(1);

    const picker = { marker: true };
    (window as W).gapi = { load: (_name: string, cb: () => void) => cb() };
    (window as W).google = { picker };
    (gapiScripts()[0] as HTMLScriptElement).onload?.(new Event("load"));

    await expect(first).resolves.toBe(picker);
    await expect(second).resolves.toBe(picker);
    await expect(loadPicker()).resolves.toBe(picker);
    expect(gapiScripts()).toHaveLength(1);
  });

  it("retries after a failed load instead of caching the failure", async () => {
    const { loadPicker } = await import("~/lib/google-picker.client");

    const failed = loadPicker();
    (gapiScripts()[0] as HTMLScriptElement).onerror?.(new Event("error"));
    await expect(failed).rejects.toThrow(/could not be loaded/);

    void loadPicker().catch(() => {});
    expect(gapiScripts(), "a second click must try again").toHaveLength(2);
  });
});
