/**
 * tools/anyprofile.server.ts
 * The newest AnyProfile release, for the download buttons on /{locale}/anyprofile.
 *
 * AnyProfile's release workflow publishes `latest.json` beside the installers
 * (its plan 261016-1546-updater-and-anytools-release; the same file its
 * in-app updater reads): a version, a date and, per platform, the asset's URL
 * and SHA-256. The page reads it so a button names the build it downloads and
 * its checksum.
 *
 * The file comes from another repository, so it is treated as untrusted:
 * - one constant URL, never anything a request names;
 * - a time limit and a size limit on the read;
 * - only an https URL under this repository's release downloads becomes a link,
 *   and only a 64-digit hex string becomes a checksum.
 *
 * Without the file (no release yet, GitHub down, a malformed manifest) the
 * buttons fall back to GitHub's /releases/latest/download/<file> redirect,
 * which is what the old site linked, so a download never depends on this read.
 */

export const ANYPROFILE_REPO = "https://github.com/D0bby999/anyprofile";
export const ANYPROFILE_RELEASES = `${ANYPROFILE_REPO}/releases/latest`;
export const ANYPROFILE_MANIFEST_URL = `${ANYPROFILE_REPO}/releases/latest/download/latest.json`;

/**
 * The manifest's platform keys, and the file each one is published as. The Mac
 * button gets the disk image (open it, drag the app onto Applications); the
 * release's .zip is the in-app updater's package, listed as "darwin-arm64".
 */
export const ANYPROFILE_PLATFORMS = {
  mac: { key: "darwin-arm64-dmg", file: "AnyProfile-macos-arm64.dmg" },
  windows: { key: "windows-amd64", file: "AnyProfile-amd64-installer.exe" },
} as const;
export type AnyProfilePlatform = keyof typeof ANYPROFILE_PLATFORMS;

export const ANYPROFILE_FALLBACK: Record<AnyProfilePlatform, string> = {
  mac: `${ANYPROFILE_REPO}/releases/latest/download/${ANYPROFILE_PLATFORMS.mac.file}`,
  windows: `${ANYPROFILE_REPO}/releases/latest/download/${ANYPROFILE_PLATFORMS.windows.file}`,
};

export type AnyProfileAsset = { url: string; sha256: string | null };
export type AnyProfileRelease = {
  version: string;
  date: string | null;
  assets: Record<AnyProfilePlatform, AnyProfileAsset | null>;
};

/** What the page renders: the release when it is known, and a link per platform either way. */
export type AnyProfileDownloads = {
  release: AnyProfileRelease | null;
  links: Record<AnyProfilePlatform, AnyProfileAsset>;
};

export const MANIFEST_MAX_BYTES = 64 * 1024;
export const MANIFEST_TIMEOUT_MS = 2500;
/** A fresh answer is kept this long; a stale one is still served while it refreshes. */
export const FRESH_MS = 10 * 60 * 1000;
/** After a failed read, wait this long before asking GitHub again. */
export const RETRY_MS = 60 * 1000;

const DOWNLOAD_PREFIX = `${ANYPROFILE_REPO}/releases/download/`;
const VERSION_RE = /^v?\d{1,4}\.\d{1,4}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,32})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const SHA256_RE = /^[0-9a-f]{64}$/i;

/**
 * An asset URL the page may link: https, this repository's release downloads,
 * one tag segment and one file name, nothing that could climb out of them.
 */
export function safeAssetUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(DOWNLOAD_PREFIX)) return null;
  const rest = value.slice(DOWNLOAD_PREFIX.length);
  const parts = rest.split("/");
  if (parts.length !== 2) return null;
  if (!parts.every((p) => /^[0-9A-Za-z][0-9A-Za-z._+-]{0,99}$/.test(p) && !p.includes(".."))) return null;
  return value;
}

/** latest.json into a release, or null if it is not one. Unknown fields are ignored. */
export function parseManifest(raw: unknown): AnyProfileRelease | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.version !== "string" || !VERSION_RE.test(m.version)) return null;
  const date = typeof m.date === "string" && DATE_RE.test(m.date) ? m.date.slice(0, 10) : null;
  const rawAssets = m.assets && typeof m.assets === "object" ? (m.assets as Record<string, unknown>) : {};

  const asset = (platform: AnyProfilePlatform): AnyProfileAsset | null => {
    const a = rawAssets[ANYPROFILE_PLATFORMS[platform].key];
    if (!a || typeof a !== "object") return null;
    const { url, sha256 } = a as Record<string, unknown>;
    const safe = safeAssetUrl(url);
    if (!safe) return null;
    return { url: safe, sha256: typeof sha256 === "string" && SHA256_RE.test(sha256) ? sha256.toLowerCase() : null };
  };

  const assets = { mac: asset("mac"), windows: asset("windows") };
  if (!assets.mac && !assets.windows) return null;
  return { version: m.version.replace(/^v/, ""), date, assets };
}

/** The body as text, or null once it passes `max` bytes. */
async function readLimited(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get("Content-Length") ?? "");
  if (Number.isFinite(declared) && declared > max) return null;
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** One read of latest.json. Never throws: a failure is null. */
export async function fetchRelease(fetcher: Fetcher = fetch): Promise<AnyProfileRelease | null> {
  try {
    const res = await fetcher(ANYPROFILE_MANIFEST_URL, {
      redirect: "follow",
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
      headers: { Accept: "application/json, application/octet-stream" },
    });
    if (!res.ok) return null;
    const text = await readLimited(res, MANIFEST_MAX_BYTES);
    if (text === null) return null;
    return parseManifest(JSON.parse(text));
  } catch {
    return null;
  }
}

type Cache = { release: AnyProfileRelease | null; at: number; ok: boolean };
let cache: Cache | null = null;
let inFlight: Promise<AnyProfileRelease | null> | null = null;

function refresh(fetcher: Fetcher, now: () => number): Promise<AnyProfileRelease | null> {
  inFlight ??= fetchRelease(fetcher)
    .then((release) => {
      // A failed read keeps the last good release rather than forgetting it.
      cache = release ? { release, at: now(), ok: true } : { release: cache?.release ?? null, at: now(), ok: false };
      return cache.release;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * The newest release, from a per-process cache. Only the very first request
 * waits on GitHub (at most MANIFEST_TIMEOUT_MS); after that a stale answer is
 * served at once while one refresh runs behind it.
 */
export async function latestRelease(fetcher: Fetcher = fetch, now: () => number = Date.now): Promise<AnyProfileRelease | null> {
  if (!cache) return refresh(fetcher, now);
  const age = now() - cache.at;
  if (age >= (cache.ok ? FRESH_MS : RETRY_MS)) void refresh(fetcher, now);
  return cache.release;
}

export function downloadsFor(release: AnyProfileRelease | null): AnyProfileDownloads {
  const link = (p: AnyProfilePlatform): AnyProfileAsset => release?.assets[p] ?? { url: ANYPROFILE_FALLBACK[p], sha256: null };
  return { release, links: { mac: link("mac"), windows: link("windows") } };
}

/** For tests: forget the cached release. */
export function resetReleaseCache(): void {
  cache = null;
  inFlight = null;
}
