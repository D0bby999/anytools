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

type PdfImage = { width: number; height: number; data?: Uint8ClampedArray; bitmap?: ImageBitmap };

/** How long to wait for one image object before giving up on it. */
const OBJECT_TIMEOUT_MS = 10_000;

/**
 * Resolve an image XObject by name.
 *
 * Two traps, both of which produce a hang rather than an error:
 *
 * 1. pdf.js routes by id prefix. An image the evaluator decides to cache across pages — a
 *    letterhead, a logo, exactly the repeated-image case this tool advertises — gets a `g_`
 *    prefix and lives in `commonObjs`, NOT `page.objs`. Asking the wrong store returns nothing.
 * 2. `PDFObjects.get(id, callback)` creates a pending entry and attaches a `.then()`. It never
 *    rejects and never times out, so a `try/catch` around it is dead code and a missing object
 *    leaves the UI on "Scanning…" until the tab is reloaded.
 */
async function resolveImage(
  page: {
    objs: { get(id: string, cb: (v: unknown) => void): void };
    commonObjs: { get(id: string, cb: (v: unknown) => void): void };
  },
  name: string,
): Promise<PdfImage | null> {
  const store = name.startsWith('g_') ? page.commonObjs : page.objs;
  return Promise.race([
    new Promise<PdfImage | null>((resolve) => {
      try {
        store.get(name, (value) => resolve((value as PdfImage) ?? null));
      } catch {
        resolve(null);
      }
    }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), OBJECT_TIMEOUT_MS)),
  ]);
}

/**
 * pdf.js hands back raw pixel data whose channel count varies with the source colour space:
 * 1 byte per pixel for greyscale, 3 for RGB, 4 for RGBA. Canvas wants RGBA, so anything else
 * has to be expanded. CMYK is NOT handled — pdf.js converts most CMYK images to RGB on the way
 * out, but not all, and guessing at a conversion would produce confidently wrong colours.
 */
export function toRgba(data: Uint8ClampedArray, width: number, height: number): ImageData | null {
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

/**
 * Identity of an extracted image for de-duplication, independent of the pdf.js object name.
 *
 * Names are not enough: the same XObject appears as `img_p0_1` on the first page it is drawn
 * on, and only from the SECOND page does pdf.js promote it to a shared `g_…` id. Deduplicating
 * on name alone therefore emits the letterhead twice (pages 1 and 2) and skips it from page 3
 * onward — measured on a three-page fixture, 2026-09-03.
 *
 * The key is a SHA-256 of the encoded bytes. A first version used dimensions + byte length; code
 * review measured 64 distinct 24×24 solid-colour PNGs collapsing to 2 lengths, so a palette or
 * icon sheet would have lost 62 images silently. Hashing costs one digest per name-unique image.
 */
export async function contentKey(png: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await png.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
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
  const seenContent = new Set<string>();

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

        const img = await resolveImage(page, name);
        if (!img || !img.width || !img.height) continue;

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new PdfRenderError(
            'noCanvasContext',
            'Your browser did not provide a 2D canvas context.',
          );
        }

        // pdf.js returns ONE OF TWO shapes and the choice is not ours to make. With
        // isOffscreenCanvasSupported (the browser default, and what openPdf sets) the worker
        // transfers an ImageBitmap and sets `data: null`; only the resized/fallback path
        // returns raw pixels. Handling just `data` meant every image was skipped and the UI
        // cheerfully reported "no embedded images found" for every document ever fed to it.
        if (img.bitmap) {
          ctx.drawImage(img.bitmap, 0, 0);
          // The bitmap is transferred to us; release it rather than waiting for GC.
          img.bitmap.close?.();
        } else if (img.data) {
          const imageData = toRgba(img.data, img.width, img.height);
          if (!imageData) continue;
          ctx.putImageData(imageData, 0, 0);
        } else {
          continue;
        }

        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
        if (!blob) continue;
        const key = await contentKey(blob);
        if (seenContent.has(key)) continue;
        seenContent.add(key);

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
