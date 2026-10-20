/**
 * security-headers.server.ts
 * The Content-Security-Policy and companion headers for every HTML document.
 *
 * What the policy has to allow, and why each origin is there:
 *  - scripts: our own bundles, inline scripts carrying this request's nonce
 *    (React Router's hydration data and the theme script), and
 *    apis.google.com for the Drive Picker; plus 'wasm-unsafe-eval', which
 *    lets the public tools compile WebAssembly and nothing else (no eval, no
 *    Function): font-converter (HarfBuzz), sql-playground (sql.js), the
 *    barcode reader (zxing-wasm), the image codecs, the HEIC decoder, the
 *    background-removal runtime, OCR in its blob: worker and Excalidraw's font
 *    subsetter (AnyTools phase 3). It is on every page, not only the tools',
 *    because a client-side navigation keeps the policy of the page it started
 *    on. 'unsafe-eval' stays out:
 *    json-schema-validator runs ajv in a worker for that reason
 *    (tools/json-schema-validator/validator-protocol.ts), and protobuf-decoder
 *    decodes without protobufjs's generated code;
 *  - styles: our own, and 'unsafe-inline' because React renders
 *    `style=` attributes (pdf.js page geometry, the reading progress bar);
 *    style injection cannot run script under this policy;
 *  - fonts: self-hosted Literata, Be Vietnam Pro and Plex Mono, plus data: for fonts pdf.js embeds;
 *  - frames: the Picker's docs.google.com dialog, and YouTube's
 *    privacy-enhanced player (www.youtube-nocookie.com) for video documents —
 *    a plain iframe, so no YouTube script runs in this origin;
 *  - workers: the pdf.js worker (self) and blob: for pdf.js internals;
 *  - connect: only our own origin — the browser never talks to the API or a
 *    model provider directly;
 *  - media: our own origin (a worksheet recording, streamed by the BFF) and
 *    blob: for the recorder's preview before "Keep" (up-methods phase 7).
 *    Without it media falls back to default-src and the preview cannot play,
 *    in production only, since dev sends no CSP.
 * The Permissions-Policy lets this origin, and nothing it frames, use the
 * microphone (the speaking worksheet records in the browser) and the camera
 * (the QR and barcode scanner reads from it). The browser still asks.
 * Everything else is 'none' or 'self'. frame-ancestors 'none' stops the app
 * being framed (clickjacking); form-action names the two OAuth hosts a sign-in
 * form navigates to.
 */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://apis.google.com 'wasm-unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    // Only what the Drive Picker loads (thumbnails and icons), and a video
    // document's thumbnail from i.ytimg.com, built from its id; note Markdown
    // never loads remote images at all (markdown-preview.tsx, audit F-13).
    "img-src 'self' data: blob: https://lh3.googleusercontent.com https://ssl.gstatic.com https://www.gstatic.com https://i.ytimg.com",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "frame-src https://docs.google.com https://drive.google.com https://www.youtube-nocookie.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com https://github.com",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * No shared cache keeps a page or its data. Cloudflare stores whatever the
 * origin lets it: a stored document names one build's hashed scripts, so after
 * the next deploy it serves a page whose scripts are gone (every tool on it
 * dead for hours), and a signed-in page must never reach someone else. The
 * browser may keep a copy but asks again each time. A route that sets its own
 * Cache-Control (home-redirect.ts) keeps it.
 */
export function applyCachePolicy(headers: Headers): void {
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "private, no-cache");
}

/** Sets the document headers. CSP only in production: Vite's dev client injects scripts with no nonce. */
export function applySecurityHeaders(headers: Headers, nonce: string, production: boolean): void {
  if (production) headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(), payment=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  applyCachePolicy(headers);
}
