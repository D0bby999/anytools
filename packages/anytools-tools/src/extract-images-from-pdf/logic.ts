import { PdfRenderError, openPdf } from '../shared/pdfjs-loader';

/**
 * Pull the images EMBEDDED in a PDF, rather than screenshots of its pages.
 *
 * Technique referenced from omni-tools (MIT) — walking each page's operator list for
 * OPS.paintImageXObject and resolving the referenced name against page.objs. Full copyright
 * and permission notice in THIRD-PARTY-NOTICES.md at the repository root; a comment alone
 * does not satisfy MIT.
 *
 * The distinction from pdf-to-png matters: a scanned page contains one image at its original
 * resolution, and rendering the page would resample it to whatever DPI was chosen. This gets
 * the original bytes' pixels back.
 */

export type ExtractedImage = {
  name: string;
  pageNumber: number;
  width: number;
  height: number;
  blob: Blob;
};

export type ExtractResult = { images: ExtractedImage[]; zip?: Blob };

/**
 * pdf.js hands back raw pixel data whose channel count varies with the source colour space:
 * 1 byte per pixel for greyscale, 3 for RGB, 4 for RGBA. Canvas wants RGBA, so anything else
 * has to be expanded. CMYK is NOT handled — pdf.js converts most CMYK images to RGB on the way
 * out, but not all, and guessing at a conversion would produce confidently wrong colours.
 */
function toRgba(data: Uint8ClampedArray, width: number, height: number): ImageData | null {
  const pixels = width * height;
  const channels = data.length / pixels;
  const out = new Uint8ClampedArray(pixels * 4);

  if (channels === 4) {
    out.set(data.subarray(0, pixels * 4));
  } else if (channels === 3) {
    for (let i = 0, j = 0; i < pixels; i++, j += 3) {
      out[i * 4] = data[j] ?? 0;
      out[i * 4 + 1] = data[j + 1] ?? 0;
      out[i * 4 + 2] = data[j + 2] ?? 0;
      out[i * 4 + 3] = 255;
    }
  } else if (channels === 1) {
    for (let i = 0; i < pixels; i++) {
      const v = data[i] ?? 0;
      out[i * 4] = v;
      out[i * 4 + 1] = v;
      out[i * 4 + 2] = v;
      out[i * 4 + 3] = 255;
    }
  } else {
    // Unknown channel count — most likely CMYK. Skip rather than invent colours.
    return null;
  }
  return new ImageData(out, width, height);
}

export async function extractImagesFromPdf(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractResult> {
  const doc = await openPdf(file);
  const base = file.name.replace(/\.pdf$/i, '');
  const images: ExtractedImage[] = [];
  // The same logo on every page is one XObject referenced many times; without this a
  // 40-page report yields 40 copies of the letterhead.
  const seen = new Set<string>();

  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const ops = await page.getOperatorList();
      const { OPS } = await import('pdfjs-dist');

      for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] !== OPS.paintImageXObject) continue;
        const name = ops.argsArray[i]?.[0] as string | undefined;
        if (!name || seen.has(name)) continue;
        seen.add(name);

        let img: { width: number; height: number; data?: Uint8ClampedArray } | undefined;
        try {
          // Objects resolve asynchronously; a name can be listed before its data arrives.
          img = await new Promise((resolve) => page.objs.get(name, resolve));
        } catch {
          continue;
        }
        if (!img?.data || !img.width || !img.height) continue;

        const imageData = toRgba(img.data, img.width, img.height);
        if (!imageData) continue;

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new PdfRenderError('Your browser did not provide a 2D canvas context.');
        ctx.putImageData(imageData, 0, 0);

        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
        if (!blob) continue;

        images.push({
          name: `${base}-p${n}-${images.length + 1}.png`,
          pageNumber: n,
          width: img.width,
          height: img.height,
          blob,
        });
      }
      page.cleanup();
      onProgress?.(n, doc.numPages);
    }
  } finally {
    await doc.destroy();
  }

  if (images.length <= 1) return { images };

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const img of images) zip.file(img.name, await img.blob.arrayBuffer());
  return { images, zip: await zip.generateAsync({ type: 'blob' }) };
}
