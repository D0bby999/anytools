// @vitest-environment node
/**
 * anyprofile-release.test.ts
 * AnyTools phase 4: the AnyProfile download buttons read the release's
 * latest.json (the manifest AnyProfile's own updater reads). The file comes
 * from another repository, so only a link into that repository's release
 * downloads and a real SHA-256 get through, the read is bounded in time and
 * size, and without it the buttons still download the latest build.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANYPROFILE_FALLBACK,
  ANYPROFILE_MANIFEST_URL,
  downloadsFor,
  fetchRelease,
  FRESH_MS,
  latestRelease,
  MANIFEST_MAX_BYTES,
  parseManifest,
  resetReleaseCache,
  RETRY_MS,
  safeAssetUrl,
  UNRELEASED,
  type ReleaseRead,
  type Fetcher,
} from "~/lib/tools/anyprofile.server";

const SHA_MAC = "a".repeat(64);
const SHA_WIN = "0123456789abcdef".repeat(4);
const BASE = "https://github.com/D0bby999/anyprofile/releases/download/v1.4.0";

/** latest.json as AnyProfile's release workflow writes it (tools/release manifest). */
function manifest(over: Record<string, unknown> = {}) {
  return {
    version: "1.4.0",
    date: "2026-10-20T08:00:00Z",
    notes: "Fixes.",
    assets: {
      // The updater's package; the page never links it.
      "darwin-arm64": { url: `${BASE}/AnyProfile-macos-arm64.zip`, sha256: "c".repeat(64), sig: "c2ln" },
      "darwin-arm64-dmg": { url: `${BASE}/AnyProfile-macos-arm64.dmg`, sha256: SHA_MAC, sig: "c2ln" },
      "windows-amd64": { url: `${BASE}/AnyProfile-amd64-installer.exe`, sha256: SHA_WIN, sig: "c2ln" },
    },
    engines: [],
    ...over,
  };
}

const ok = (body: unknown): Fetcher => async () => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  resetReleaseCache();
  vi.unstubAllGlobals();
});

describe("parseManifest", () => {
  it("reads the version, the day and each platform's link and checksum", () => {
    expect(parseManifest(manifest())).toEqual({
      version: "1.4.0",
      date: "2026-10-20",
      assets: {
        mac: { url: `${BASE}/AnyProfile-macos-arm64.dmg`, sha256: SHA_MAC },
        windows: { url: `${BASE}/AnyProfile-amd64-installer.exe`, sha256: SHA_WIN },
      },
    });
  });

  it("drops a leading v and keeps a pre-release tag", () => {
    expect(parseManifest(manifest({ version: "v2.0.0-beta.1" }))?.version).toBe("2.0.0-beta.1");
  });

  it("is null for anything that is not a release", () => {
    for (const bad of [null, "1.4.0", [], {}, manifest({ version: 140 }), manifest({ version: "<b>1</b>" }), manifest({ version: "latest" }), manifest({ assets: {} }), manifest({ assets: null })]) {
      expect(parseManifest(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("keeps a platform out when its link leaves the repository's release downloads", () => {
    const hostile = [
      "javascript:alert(1)",
      "http://github.com/D0bby999/anyprofile/releases/download/v1/AnyProfile-macos-arm64.zip",
      "https://evil.example/AnyProfile-macos-arm64.zip",
      "https://github.com/D0bby999/anyprofile-evil/releases/download/v1/a.zip",
      "https://github.com/someone/anyprofile/releases/download/v1/a.zip",
      "https://github.com/D0bby999/anyprofile/releases/download/v1/../../../evil/a.zip",
      "https://github.com/D0bby999/anyprofile/releases/download/v1/sub/a.zip",
      "https://github.com/D0bby999/anyprofile/releases/download/v1/a.zip?x=https://evil.example",
      "https://github.com/D0bby999/anyprofile/releases/download/v1/a.zip#frag",
      "https://github.com/D0bby999/anyprofile/releases/download//a.zip",
    ];
    for (const url of hostile) {
      expect(safeAssetUrl(url), url).toBeNull();
      const parsed = parseManifest(manifest({ assets: { "darwin-arm64-dmg": { url, sha256: SHA_MAC }, "windows-amd64": { url: `${BASE}/AnyProfile-amd64-installer.exe`, sha256: SHA_WIN } } }));
      expect(parsed?.assets.mac, url).toBeNull();
      expect(parsed?.assets.windows?.sha256).toBe(SHA_WIN);
    }
  });

  it("shows no checksum that is not 64 hex digits", () => {
    for (const sha256 of ["abc", "g".repeat(64), `${SHA_MAC}0`, 42, null]) {
      const parsed = parseManifest(manifest({ assets: { "darwin-arm64-dmg": { url: `${BASE}/AnyProfile-macos-arm64.dmg`, sha256 } } }));
      expect(parsed?.assets.mac).toEqual({ url: `${BASE}/AnyProfile-macos-arm64.dmg`, sha256: null });
    }
  });
});

/** The version a read names, whatever else it is. */
const versionOf = (r: ReleaseRead) => (r && r !== UNRELEASED ? r.version : r);

describe("fetchRelease", () => {
  it("asks for the one manifest URL, with a time limit", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const release = await fetchRelease(async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(manifest()));
    });
    expect(versionOf(release)).toBe("1.4.0");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(ANYPROFILE_MANIFEST_URL);
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("is UNRELEASED when GitHub has no published release", async () => {
    expect(await fetchRelease(async () => new Response("Not Found", { status: 404 }))).toBe(UNRELEASED);
  });

  it("is null on an error status, bad JSON, a network failure or a timeout", async () => {
    expect(await fetchRelease(async () => new Response("nope", { status: 502 }))).toBeNull();
    expect(await fetchRelease(async () => new Response("{not json"))).toBeNull();
    expect(await fetchRelease(async () => Promise.reject(new TypeError("fetch failed")))).toBeNull();
    expect(await fetchRelease(async () => Promise.reject(new DOMException("timed out", "TimeoutError")))).toBeNull();
  });

  it("stops reading past the size limit, whatever the header claims", async () => {
    const padded = JSON.stringify({ ...manifest(), notes: "x".repeat(MANIFEST_MAX_BYTES) });
    expect(await fetchRelease(async () => new Response(padded))).toBeNull();
    expect(await fetchRelease(async () => new Response("{}", { headers: { "Content-Length": String(MANIFEST_MAX_BYTES + 1) } }))).toBeNull();

    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(16 * 1024).fill(32));
      },
    });
    expect(await fetchRelease(async () => new Response(endless))).toBeNull();
    expect(pulled).toBeLessThan(10);
  });
});

describe("latestRelease", () => {
  it("reads once, then serves from memory while fresh", async () => {
    let now = 1_000_000;
    const fetcher = vi.fn(ok(manifest()));
    expect(versionOf(await latestRelease(fetcher, () => now))).toBe("1.4.0");
    now += FRESH_MS - 1;
    expect(versionOf(await latestRelease(fetcher, () => now))).toBe("1.4.0");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("serves the stale release at once and refreshes behind it", async () => {
    let now = 0;
    await latestRelease(ok(manifest()), () => now);
    now += FRESH_MS;
    const next = vi.fn(ok(manifest({ version: "1.5.0" })));
    expect(versionOf(await latestRelease(next, () => now))).toBe("1.4.0");
    expect(next).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () => expect(versionOf(await latestRelease(next, () => now))).toBe("1.5.0"));
  });

  it("keeps the last good release through a failed refresh, and retries sooner after a failure", async () => {
    let now = 0;
    await latestRelease(ok(manifest()), () => now);
    now += FRESH_MS;
    const failing = vi.fn<Fetcher>(async () => new Response("", { status: 502 }));
    await latestRelease(failing, () => now);
    await vi.waitFor(() => expect(failing).toHaveBeenCalledTimes(1));
    expect(versionOf(await latestRelease(failing, () => now))).toBe("1.4.0");
    now += RETRY_MS;
    await latestRelease(failing, () => now);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("is null until a release has ever been read", async () => {
    expect(await latestRelease(async () => new Response("", { status: 502 }), () => 0)).toBeNull();
  });

  it("stops serving a release once it is taken back", async () => {
    let now = 0;
    await latestRelease(ok(manifest()), () => now);
    now += FRESH_MS;
    const gone = vi.fn<Fetcher>(async () => new Response("", { status: 404 }));
    await latestRelease(gone, () => now);
    await vi.waitFor(async () => expect(await latestRelease(gone, () => now)).toBe(UNRELEASED));
  });
});

describe("downloadsFor", () => {
  it("links the release's own builds when it is known", () => {
    const d = downloadsFor(parseManifest(manifest()));
    expect(d.links.mac).toEqual({ url: `${BASE}/AnyProfile-macos-arm64.dmg`, sha256: SHA_MAC });
    expect(d.links.windows.url).toBe(`${BASE}/AnyProfile-amd64-installer.exe`);
  });

  it("is unreleased only on GitHub's 404, never on a failed read", () => {
    expect(downloadsFor(UNRELEASED)).toMatchObject({ release: null, unreleased: true });
    expect(downloadsFor(null).unreleased).toBe(false);
    expect(downloadsFor(parseManifest(manifest())).unreleased).toBe(false);
  });

  it("falls back to GitHub's latest-release redirect, per platform", () => {
    expect(downloadsFor(null).links).toEqual({
      mac: { url: "https://github.com/D0bby999/anyprofile/releases/latest/download/AnyProfile-macos-arm64.dmg", sha256: null },
      windows: { url: "https://github.com/D0bby999/anyprofile/releases/latest/download/AnyProfile-amd64-installer.exe", sha256: null },
    });
    const macOnly = parseManifest(manifest({ assets: { "darwin-arm64-dmg": { url: `${BASE}/AnyProfile-macos-arm64.dmg`, sha256: SHA_MAC } } }));
    expect(downloadsFor(macOnly).links.windows).toEqual({ url: ANYPROFILE_FALLBACK.windows, sha256: null });
    // A release made before the disk image (0.1.1's latest.json) lists only the
    // updater's .zip: the Mac button still gets the image, by the redirect.
    const zipOnly = parseManifest(manifest({ assets: { "darwin-arm64": { url: `${BASE}/AnyProfile-macos-arm64.zip`, sha256: SHA_MAC } } }));
    expect(downloadsFor(zipOnly).links.mac).toEqual({ url: ANYPROFILE_FALLBACK.mac, sha256: null });
  });
});
