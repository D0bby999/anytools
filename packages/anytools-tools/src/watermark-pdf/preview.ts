/**
 * The preview half of watermark-pdf, kept apart from logic.ts because it is a different engine
 * with different failure modes: this renders through pdf.js onto a canvas, while the stamping
 * itself is pure pdf-lib. Splitting them also means a preview that fails — an unusual document
 * pdf.js will not draw — cannot stop the tool from doing its actual job.
 */
import { PdfRenderError, openPdf } from '../shared/pdfjs-loader';

/** Preview at 96 dpi — one CSS pixel per point, which is what the CSS overlay is measured in. */
export const PREVIEW_DPI = 96;

/**
 * Render page 1.
 *
 * Page 1 only, and once per file. The watermark on top of it is drawn with CSS, so moving the
 * angle or opacity slider costs nothing; putting a pdf.js render behind every slider tick would
 * make the controls unusable on any real document.
 */
export async function renderFirstPage(
  file: File,
): Promise<{ blob: Blob; width: number; height: number }> {
  const doc = await openPdf(file);
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: PREVIEW_DPI / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PdfRenderError('Your browser did not provide a 2D canvas context.');
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new PdfRenderError('The preview page could not be encoded.');
    page.cleanup();
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    // Release the worker's copy of the document even if rendering threw.
    await doc.destroy();
  }
}
