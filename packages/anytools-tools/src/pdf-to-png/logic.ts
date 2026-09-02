import { PdfRenderError, openPdf } from '../shared/pdfjs-loader';

export type Dpi = 72 | 150 | 300;

export type RenderedPage = {
  pageNumber: number;
  name: string;
  width: number;
  height: number;
  blob: Blob;
};

export type PdfToPngResult = { pages: RenderedPage[]; zip?: Blob };

/** PDF user space is 72 units per inch, so scale is simply dpi/72. */
export const scaleForDpi = (dpi: Dpi): number => dpi / 72;

/**
 * Guard against a page that would exceed the canvas ceiling at the requested DPI.
 * A0 at 300 DPI is ~100 megapixels; browsers return a blank canvas rather than an error.
 */
export const MAX_CANVAS_PIXELS = 16_777_216;

export async function pdfToPng(
  file: File,
  dpi: Dpi,
  onProgress?: (done: number, total: number) => void,
): Promise<PdfToPngResult> {
  const doc = await openPdf(file);
  const scale = scaleForDpi(dpi);
  const base = file.name.replace(/\.pdf$/i, '');
  const pages: RenderedPage[] = [];

  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });

      if (viewport.width * viewport.height > MAX_CANVAS_PIXELS) {
        throw new PdfRenderError(
          `Page ${n} would be ${Math.round(viewport.width)}x${Math.round(viewport.height)} pixels at ${dpi} DPI, past what browsers can render. Try a lower DPI.`,
        );
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new PdfRenderError('Your browser did not provide a 2D canvas context.');

      await page.render({ canvas, canvasContext: ctx, viewport }).promise;

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new PdfRenderError(`Page ${n} could not be encoded as PNG.`);

      pages.push({
        pageNumber: n,
        // Pad so a 100-page document sorts correctly in a file manager.
        name: `${base}-p${String(n).padStart(String(doc.numPages).length, '0')}.png`,
        width: canvas.width,
        height: canvas.height,
        blob,
      });
      page.cleanup();
      onProgress?.(n, doc.numPages);
    }
  } finally {
    // Release the worker's copy of the document even if a page threw.
    await doc.destroy();
  }

  if (pages.length === 1) return { pages };

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const p of pages) zip.file(p.name, await p.blob.arrayBuffer());
  return { pages, zip: await zip.generateAsync({ type: 'blob' }) };
}
