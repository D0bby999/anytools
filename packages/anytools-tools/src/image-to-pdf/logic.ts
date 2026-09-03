// pdf-lib is imported dynamically inside the function, never at module top level — same reason
// as merge-pdf: a top-level import pulls ~173 KB gzipped into anything that touches this module.
import { type EmbeddableImage, ownBuffer, toEmbeddableImage } from '../shared/embeddable-image';

/** Page sizes in PostScript points, the unit PDF itself uses. 1 pt = 1/72 inch. */
export const PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89, label: 'A4' },
  letter: { width: 612, height: 792, label: 'US Letter' },
} as const;

export type PageSizeId = keyof typeof PAGE_SIZES | 'fit';
export type OrientationId = 'auto' | 'portrait' | 'landscape';

/**
 * Pixels-per-inch assumed when the page is sized to the image ("fit").
 *
 * 96 is the CSS pixel — the unit a screenshot is already measured in, and what the browser
 * reports for every image — so a 1920x1080 screenshot becomes a 1440x810 pt page rather than
 * a page whose size depends on a number nobody chose. It does mean a large photo produces a
 * physically large page; that is inherent to "no white bars", and the FAQ says so.
 */
export const FIT_DPI = 96;

/** Target resolution when downscaling to the printed size. Above this, print gains nothing. */
export const PRINT_DPI = 150;

export type ImageToPdfOptions = {
  pageSize: PageSizeId;
  /** Ignored when pageSize is 'fit' — the image decides. */
  orientation: OrientationId;
  /** White space on every side, in points. */
  margin: number;
  /** Shrink each image to PRINT_DPI at its printed size. Ignored when pageSize is 'fit'. */
  downscale: boolean;
};

export type PageLayout = {
  page: { width: number; height: number };
  /** Where the image is drawn on that page, in points, origin bottom-left. */
  image: { x: number; y: number; width: number; height: number };
};

export type ImageToPdfResult = {
  blob: Blob;
  pages: number;
  sources: { name: string; pixels: string; page: string }[];
};

export class ImageToPdfError extends Error {
  constructor(
    message: string,
    readonly fileName?: string,
  ) {
    super(message);
    this.name = 'ImageToPdfError';
  }
}

/**
 * Work out the page and the rectangle the image occupies on it. Pure, and the only place the
 * geometry lives — the browser-side preparation below reads its pixel budget out of the same
 * function that positions the image, so the two can never disagree.
 */
export function layoutPage(
  image: { width: number; height: number },
  opts: ImageToPdfOptions,
): PageLayout {
  const margin = Math.max(0, opts.margin);

  if (opts.pageSize === 'fit') {
    const width = (image.width * 72) / FIT_DPI;
    const height = (image.height * 72) / FIT_DPI;
    return {
      page: { width: width + margin * 2, height: height + margin * 2 },
      image: { x: margin, y: margin, width, height },
    };
  }

  const base = PAGE_SIZES[opts.pageSize];
  const landscape =
    opts.orientation === 'landscape' || (opts.orientation === 'auto' && image.width > image.height);
  const page = landscape
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height };

  const availWidth = page.width - margin * 2;
  const availHeight = page.height - margin * 2;
  if (availWidth <= 0 || availHeight <= 0) {
    throw new ImageToPdfError(
      `A margin of ${Math.round(margin)} pt leaves no room on a ${base.label} page. Use less than ${Math.floor(Math.min(page.width, page.height) / 2)} pt.`,
    );
  }

  // Deliberately not `fitWithin` from canvas-image: that helper caps the scale at 1 so it can
  // never enlarge, which is right for resizing a bitmap and wrong here. Scaling is to the page
  // in points, not to pixels, so a small image filling the page loses no information.
  const scale = Math.min(availWidth / image.width, availHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    page,
    image: { x: (page.width - width) / 2, y: (page.height - height) / 2, width, height },
  };
}

/**
 * Decode, orient and re-encode each file on the main thread's canvas.
 *
 * Separated from `imagesToPdf` because this half cannot run outside a browser — happy-dom
 * returns null for `getContext('2d')` and never calls back from `toBlob`. The unit tests
 * therefore drive `imagesToPdf` with images built directly, and this half is covered by the
 * browser lane in docs/tool-runtime-verification.md.
 */
export async function prepareImages(
  files: File[],
  opts: ImageToPdfOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<EmbeddableImage[]> {
  const budget =
    opts.downscale && opts.pageSize !== 'fit'
      ? (size: { width: number; height: number }) => {
          const { image } = layoutPage(size, opts);
          const px = (pt: number) => Math.round((pt / 72) * PRINT_DPI);
          return { width: px(image.width), height: px(image.height) };
        }
      : undefined;

  const out: EmbeddableImage[] = [];
  // Sequential rather than Promise.all: twenty 12 MP photos decoded at once is several
  // gigabytes of pixel buffers, and the tab dies without an error anyone can act on.
  for (const file of files) {
    out.push(await toEmbeddableImage(file, budget));
    onProgress?.(out.length, files.length);
  }
  return out;
}

/** One image per page, in the order given. */
export async function imagesToPdf(
  images: EmbeddableImage[],
  opts: ImageToPdfOptions,
): Promise<ImageToPdfResult> {
  if (images.length === 0) throw new ImageToPdfError('Choose at least one image.');

  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const sources: ImageToPdfResult['sources'] = [];

  for (const img of images) {
    const { page: size, image: box } = layoutPage(img, opts);
    const bytes = ownBuffer(img.bytes);
    let embedded: Awaited<ReturnType<typeof doc.embedPng>>;
    try {
      embedded = img.format === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    } catch {
      throw new ImageToPdfError(`"${img.name}" could not be embedded as an image.`, img.name);
    }
    doc.addPage([size.width, size.height]).drawImage(embedded, box);
    sources.push({
      name: img.name,
      pixels: `${img.width}x${img.height}`,
      page: `${Math.round(size.width)}x${Math.round(size.height)} pt`,
    });
  }

  const bytes = await doc.save();
  return {
    // Copy into a fresh ArrayBuffer: pdf-lib returns a view over a pooled buffer, and handing
    // that straight to Blob can capture more than the document's own bytes.
    blob: new Blob([bytes.slice()], { type: 'application/pdf' }),
    pages: doc.getPageCount(),
    sources,
  };
}
