import { loadBitmap } from '../shared/canvas-image';
import {
  type OcrBlock,
  type OcrLanguage,
  type OcrProgress,
  type OcrResult,
  prepareForOcr,
  recognize,
} from '../shared/tesseract-loader';

export type ImageOcrItem = {
  name: string;
  /** Kept rather than pre-joined so the line-break toggle re-formats without a second OCR pass. */
  blocks: OcrBlock[];
  confidence: number;
  words: number;
};

export type ImageOcrProgress = {
  /** One-based index of the image being read. */
  index: number;
  total: number;
  name: string;
  stage: OcrProgress;
};

/**
 * Turn tesseract's block/line tree into text.
 *
 * Tesseract's own `data.text` keeps every line break it detected, which is right for a poem and
 * wrong for a paragraph: printed prose wraps at the column edge, so pasting the raw output into
 * a document leaves a hard break every eight words. `keepLineBreaks: false` unwraps within a
 * block and keeps the blank line between blocks, which is what someone re-using the text wants.
 * Neither choice is safe as the only behaviour, hence the toggle.
 */
export function formatOcrText(blocks: OcrBlock[], keepLineBreaks: boolean): string {
  return blocks
    .map((block) => {
      const lines = block.lines.map((l) => l.text.trim()).filter((l) => l.length > 0);
      return keepLineBreaks ? lines.join('\n') : lines.join(' ');
    })
    .filter((b) => b.length > 0)
    .join('\n\n');
}

/** Total words recognised, used to weight confidence across images of different sizes. */
export function countWords(blocks: OcrBlock[]): number {
  let n = 0;
  for (const block of blocks) for (const line of block.lines) n += line.words.length;
  return n;
}

/**
 * Confidence across several images, weighted by word count.
 *
 * A plain average would let a business card with four words drag down the number for a full
 * page beside it. Images that produced no words are excluded rather than counted as zero — an
 * unreadable photo is a separate fact, reported per image.
 */
export function meanConfidence(items: Pick<ImageOcrItem, 'confidence' | 'words'>[]): number {
  const scored = items.filter((i) => i.words > 0);
  const total = scored.reduce((sum, i) => sum + i.words, 0);
  if (total === 0) return 0;
  return scored.reduce((sum, i) => sum + i.confidence * i.words, 0) / total;
}

/** One `.txt` for the whole batch. A single image gets no header; several get one each. */
export function combineText(items: ImageOcrItem[], keepLineBreaks: boolean): string {
  const texts = items.map((i) => formatOcrText(i.blocks, keepLineBreaks));
  if (items.length === 1) return texts[0] ?? '';
  return items.map((i, n) => `--- ${i.name} ---\n${texts[n] ?? ''}`).join('\n\n');
}

/** `photo.jpg` becomes `photo.txt`; a batch is named after the first file. */
export function textFileName(items: ImageOcrItem[]): string {
  const base = (items[0]?.name ?? 'ocr').replace(/\.[^.]+$/, '');
  return items.length > 1 ? `${base}-and-${items.length - 1}-more.txt` : `${base}.txt`;
}

/**
 * Read every image in order.
 *
 * Sequential on purpose: one tesseract worker handles one job at a time, and a parallel version
 * would need a scheduler plus a second copy of the 3.8 MB core per worker for no gain on the
 * batch sizes this tool sees.
 */
export async function ocrImages(
  files: File[],
  lang: OcrLanguage,
  onProgress?: (p: ImageOcrProgress) => void,
): Promise<ImageOcrItem[]> {
  const items: ImageOcrItem[] = [];
  for (const [i, file] of files.entries()) {
    const bitmap = await loadBitmap(file);
    let result: OcrResult;
    try {
      const canvas = prepareForOcr(bitmap, bitmap.width, bitmap.height);
      result = await recognize(lang, canvas, (stage) =>
        onProgress?.({ index: i + 1, total: files.length, name: file.name, stage }),
      );
    } finally {
      bitmap.close();
    }
    items.push({
      name: file.name,
      blocks: result.blocks,
      confidence: result.confidence,
      words: countWords(result.blocks),
    });
  }
  return items;
}
