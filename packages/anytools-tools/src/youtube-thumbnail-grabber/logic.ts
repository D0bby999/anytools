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
 * - i.ytimg.com sends `Access-Control-Allow-Origin: *`. That is NOT enough for `fetch()` here:
 *   this app's own CSP is `connect-src 'self'`, so a cross-origin fetch is refused by the page
 *   before the CDN is ever asked, and the download button could only ever fall back to opening
 *   a tab. `img-src` is `'self' data: blob: https:`, so the image itself is allowed to load —
 *   downloadThumbnail() therefore goes through <img crossOrigin="anonymous"> + canvas.toBlob(),
 *   which the open CORS header keeps un-tainted. No CSP change was made for this tool.
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
 * Reads a thumbnail into a Blob so the browser can save a real file.
 *
 * Goes through an <img> rather than fetch() on purpose — see the CSP note in the file header.
 * `crossOrigin="anonymous"` plus the CDN's `Access-Control-Allow-Origin: *` keeps the canvas
 * un-tainted, which is what makes toBlob() legal here; without the attribute the draw succeeds
 * and toBlob() throws a SecurityError instead.
 */
export function downloadThumbnail(url: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () =>
      reject(new ToolError('networkFailed', "Could not reach YouTube's image server."));
    img.onload = () => {
      // Same placeholder trap as the preview: a missing size answers 404 with a decodable
      // 120x90 grey JPEG, so a successful load is not proof the size exists.
      if (img.naturalWidth <= 120 && img.naturalHeight <= 90) {
        reject(
          new ToolError(
            'thumbnailMissing',
            'YouTube has no image at this size for this video — it returned the grey placeholder.',
          ),
        );
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new ToolError('networkFailed', 'This browser refused to open a canvas.'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new ToolError('networkFailed', 'The image could not be re-encoded.')),
        'image/jpeg',
        0.95,
      );
    };
    img.src = url;
  });
}
