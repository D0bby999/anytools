/**
 * Load pdf.js and open a document with the hardening these tools require.
 *
 * SECURITY. This is the first place the site parses a file supplied by a stranger with a
 * complex parser. pdf.js has a documented class of arbitrary-JS-execution bugs reached through
 * the font path — CVE-2024-4367 evaluated an attacker-controlled FontMatrix, patched in
 * 4.2.67 — and this origin also serves /api/auth and holds a 30-day better-auth session
 * cookie. A successful escape would read that cookie.
 *
 * Hence, in order of importance:
 *   1. `pdfjs-dist` is pinned to an exact version in package.json, not a caret range. A
 *      lockfile drift back across a security patch must not be possible silently.
 *   2. `isEvalSupported: false` disables the eval-based font compilation path that the known
 *      class of bugs runs through. It costs a little rendering speed on some documents.
 *   3. `disableFontFace: true` keeps fonts from being installed into the document at all;
 *      pdf.js falls back to drawing glyph paths, which is slower and visually equivalent for
 *      the raster output these tools produce.
 *   4. A Content-Security-Policy (report-only for now) is set in next.config.ts.
 *
 * Callers must additionally never render a user-supplied filename as HTML. React escapes text
 * children by default, so this only means: no dangerouslySetInnerHTML.
 */

export class PdfRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfRenderError';
  }
}

type PdfjsModule = typeof import('pdfjs-dist');
let cached: PdfjsModule | null = null;

/**
 * Import pdf.js and point it at its worker.
 *
 * `new URL(..., import.meta.url)` is the form bundlers understand: webpack and Turbopack both
 * rewrite it to the emitted asset path at build time, so the worker is served from our own
 * origin rather than a CDN. Nothing here is fetched from a third party.
 */
export async function loadPdfjs(): Promise<PdfjsModule> {
  if (cached) return cached;
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  cached = pdfjs;
  return pdfjs;
}

/** Open a document with the hardened options. Always use this rather than getDocument directly. */
export async function openPdf(file: File) {
  const pdfjs = await loadPdfjs();
  try {
    return await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      isEvalSupported: false,
      disableFontFace: true,
      // Do not let a document pull in remote resources of its own.
      isOffscreenCanvasSupported: true,
    }).promise;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/password/i.test(msg)) {
      throw new PdfRenderError(
        `"${file.name}" is password-protected. Remove the password and try again.`,
      );
    }
    if (/worker/i.test(msg)) {
      // Distinctive enough to recognise instantly: this is a build/bundler problem, not a
      // problem with the user's file, and the two look identical from the UI.
      throw new PdfRenderError(
        'The PDF renderer failed to start (worker could not load). This is a bug on our side, not a problem with your file.',
      );
    }
    throw new PdfRenderError(`"${file.name}" could not be read as a PDF.`);
  }
}
