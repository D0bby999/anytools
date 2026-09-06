/**
 * YouTube video id extraction and thumbnail URLs.
 *
 * This is the one tool in its batch that talks to a third-party server at all: thumbnails are
 * served from YouTube's own image CDN (i.ytimg.com), not fetched or proxied by us, so the id
 * you enter reaches YouTube's servers the moment the browser requests an image. See ui.tsx's
 * PrivacyNote for the disclosure — the site's default "nothing leaves your browser" note would
 * be false here.
 *
 * Verified against the real CDN on 2026-09-06 (see phase report for the raw requests):
 * - i.ytimg.com sends `Access-Control-Allow-Origin: *`, so `fetch()` for the download button
 *   works cross-origin without a proxy.
 * - A missing maxresdefault answers HTTP 404 — BUT the response body is still a decodable
 *   120×90 grey-placeholder JPEG (`content-type: image/jpeg`, confirmed via curl + `sips` on
 *   both a garbage id and a real video old enough to lack every size above mqdefault). A plain
 *   `<img>` decodes that body and fires `onload`, not `onerror`, regardless of the 404 status —
 *   `onerror` alone never catches this. The UI (ui.tsx) therefore checks the DECODED pixel
 *   dimensions on load and only trusts a size that came back larger than the placeholder.
 */

import { ToolError } from '../shared/tool-error';

export type ThumbnailKey = 'maxresdefault' | 'sddefault' | 'hqdefault' | 'mqdefault';

/** Highest to lowest quality — also the fallback order the preview <img> walks on error. */
export const THUMBNAIL_ORDER: ThumbnailKey[] = [
  'maxresdefault',
  'sddefault',
  'hqdefault',
  'mqdefault',
];

/** Real, verified pixel dimensions of each file (curl + sips, 2026-09-06). */
export const THUMBNAIL_SIZES: Record<ThumbnailKey, { width: number; height: number }> = {
  maxresdefault: { width: 1280, height: 720 },
  sddefault: { width: 640, height: 480 },
  hqdefault: { width: 480, height: 360 },
  mqdefault: { width: 320, height: 180 },
};

export function thumbnailUrl(videoId: string, key: ThumbnailKey): string {
  return `https://i.ytimg.com/vi/${videoId}/${key}.jpg`;
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Pull an 11-character video id out of watch/shorts/embed/live/youtu.be links, or accept a bare
 * id typed directly. Extra query params (&t=, &list=, &si=…) are ignored via URL parsing rather
 * than string-splitting, so a full share link with tracking params still works.
 */
export function parseYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (VIDEO_ID_RE.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.split('/')[1] ?? '';
    return VIDEO_ID_RE.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v') ?? '';
      return VIDEO_ID_RE.test(id) ? id : null;
    }
    const m = /^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
    if (m?.[1]) return m[1];
  }
  return null;
}

/**
 * Downloads a thumbnail as a Blob for a real file save. i.ytimg.com's open CORS policy (see
 * file header) means this works directly; the caller still needs a fallback for the rare case
 * fetch itself fails (offline, an extension blocking the request) — see ui.tsx.
 */
export async function fetchThumbnailBlob(url: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new ToolError('networkFailed', "Could not reach YouTube's image server.");
  }
  if (!response.ok) {
    throw new ToolError(
      'thumbnailMissing',
      `YouTube returned ${response.status} for this thumbnail size — it may not exist for this video.`,
      { status: response.status },
    );
  }
  return response.blob();
}
