/**
 * The formatting and aggregation this tool does AFTER tesseract returns.
 *
 * Recognition itself needs a canvas, a WebAssembly worker and 4 MB of language data, none of
 * which exist under happy-dom — that half is verified in the browser lane (see the Verify
 * section of plans/…/phase-06-ocr.md). What is tested here is everything that decides what the
 * user actually sees: how a block tree becomes text, and how confidence is summarised.
 */
import { describe, expect, it, vi } from 'vitest';
import type { OcrBlock } from '../shared/tesseract-loader';
import {
  combineText,
  countWords,
  formatOcrText,
  meanConfidence,
  ocrImages,
  textFileName,
} from './logic';

// Hoisted: vi.mock factories are lifted above the imports, so these have to be too.
const { loadBitmap, recognizeImage } = vi.hoisted(() => ({
  loadBitmap: vi.fn(),
  recognizeImage: vi.fn(),
}));

vi.mock('../shared/canvas-image', () => ({ loadBitmap }));
vi.mock('../shared/tesseract-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/tesseract-loader')>();
  return {
    ...actual,
    // happy-dom has no 2D context, and neither step is what these tests are about.
    prepareForOcr: () => ({ width: 10, height: 10 }) as HTMLCanvasElement,
    recognize: recognizeImage,
  };
});

const word = (text: string) => ({ text, confidence: 90, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } });
const line = (text: string) => ({ text, words: text.split(' ').map(word) });

const twoBlocks: OcrBlock[] = [
  { lines: [line('The quick brown fox'), line('jumps over the lazy dog.')] },
  { lines: [line('Second paragraph here.')] },
];

describe('formatOcrText', () => {
  it('unwraps hard-wrapped lines inside a block by default', () => {
    expect(formatOcrText(twoBlocks, false)).toBe(
      'The quick brown fox jumps over the lazy dog.\n\nSecond paragraph here.',
    );
  });

  it('keeps every line break when asked', () => {
    expect(formatOcrText(twoBlocks, true)).toBe(
      'The quick brown fox\njumps over the lazy dog.\n\nSecond paragraph here.',
    );
  });

  it('trims the trailing newline tesseract puts on every line', () => {
    const blocks: OcrBlock[] = [{ lines: [{ text: 'Invoice 4815\n', words: [word('Invoice')] }] }];
    expect(formatOcrText(blocks, true)).toBe('Invoice 4815');
  });

  it('drops empty lines and empty blocks rather than emitting blank paragraphs', () => {
    const blocks: OcrBlock[] = [
      { lines: [{ text: '  \n', words: [] }] },
      { lines: [line('Real text')] },
      { lines: [] },
    ];
    expect(formatOcrText(blocks, false)).toBe('Real text');
  });

  it('returns an empty string when nothing was recognised', () => {
    expect(formatOcrText([], false)).toBe('');
  });
});

describe('countWords', () => {
  it('sums words across blocks and lines', () => {
    expect(countWords(twoBlocks)).toBe(4 + 5 + 3);
  });
});

describe('meanConfidence', () => {
  it('weights by word count, not by image', () => {
    // A 4-word caption at 40% must not halve a 96-word page at 90%.
    const value = meanConfidence([
      { confidence: 90, words: 96 },
      { confidence: 40, words: 4 },
    ]);
    expect(value).toBeCloseTo(88, 5);
  });

  it('ignores images that produced no words instead of scoring them zero', () => {
    expect(
      meanConfidence([
        { confidence: 88, words: 10 },
        { confidence: 0, words: 0 },
      ]),
    ).toBe(88);
  });

  it('is zero when nothing was recognised at all', () => {
    expect(meanConfidence([{ confidence: 0, words: 0 }])).toBe(0);
    expect(meanConfidence([])).toBe(0);
  });
});

describe('combineText', () => {
  const items = [
    { name: 'a.png', blocks: [{ lines: [line('First')] }], confidence: 90, words: 1 },
    { name: 'b.png', blocks: [{ lines: [line('Second')] }], confidence: 80, words: 1 },
  ];

  it('leaves a file that could not be read out of the .txt entirely', () => {
    const withFailure = [
      items[0]!,
      { name: 'b.png', blocks: [], confidence: 0, words: 0, error: 'Not an image.' },
    ];
    // Not "--- b.png ---" followed by nothing: the error belongs on screen, not in the output.
    expect(combineText(withFailure, false)).toBe('First');
  });

  it('adds no header for a single image', () => {
    expect(combineText([items[0]!], false)).toBe('First');
  });

  it('labels each image when there are several', () => {
    expect(combineText(items, false)).toBe('--- a.png ---\nFirst\n\n--- b.png ---\nSecond');
  });

  it('passes the line-break choice through to every image', () => {
    const wrapped = [
      {
        name: 'a.png',
        blocks: [{ lines: [line('One'), line('Two')] }],
        confidence: 90,
        words: 2,
      },
    ];
    expect(combineText(wrapped, true)).toBe('One\nTwo');
    expect(combineText(wrapped, false)).toBe('One Two');
  });
});

describe('textFileName', () => {
  it('swaps the image extension for .txt', () => {
    expect(textFileName([{ name: 'receipt.JPG', blocks: [], confidence: 0, words: 0 }])).toBe(
      'receipt.txt',
    );
  });

  it('names a batch after the first file', () => {
    const item = { blocks: [], confidence: 0, words: 0 };
    expect(
      textFileName([
        { name: 'page-1.png', ...item },
        { name: 'page-2.png', ...item },
        { name: 'page-3.png', ...item },
      ]),
    ).toBe('page-1-and-2-more.txt');
  });

  it('falls back to a usable name when there are no items', () => {
    expect(textFileName([])).toBe('ocr.txt');
  });
});

/**
 * The batch loop. One unreadable file used to throw out of it and discard every image already
 * recognised — the nineteen good ones and the minutes they cost with them.
 */
describe('ocrImages', () => {
  const file = (name: string) => new File([new Uint8Array([1])], name, { type: 'image/png' });
  const bitmap = () => ({ width: 10, height: 10, close: vi.fn() });
  const recognised = (text: string) => ({
    text,
    confidence: 90,
    blocks: [{ lines: [line(text)] }],
    width: 10,
    height: 10,
  });

  it('records the failure against the one file and reads the rest', async () => {
    loadBitmap.mockReset();
    recognizeImage.mockReset();
    loadBitmap
      .mockResolvedValueOnce(bitmap())
      .mockRejectedValueOnce(new Error('"broken.png" could not be read as an image.'))
      .mockResolvedValueOnce(bitmap());
    recognizeImage
      .mockResolvedValueOnce(recognised('First'))
      .mockResolvedValueOnce(recognised('Third'));

    const items = await ocrImages(
      [file('a.png'), file('broken.png'), file('c.png')],
      'eng',
      undefined,
    );

    expect(items.map((i) => i.name)).toEqual(['a.png', 'broken.png', 'c.png']);
    expect(items[1]?.error).toBe('"broken.png" could not be read as an image.');
    expect(items[1]?.words).toBe(0);
    expect(items[0]?.words).toBe(1);
    expect(items[2]?.words).toBe(1);
    expect(combineText(items, false)).toBe('--- a.png ---\nFirst\n\n--- c.png ---\nThird');
    // A failed file must not drag the average down as if it had scored zero.
    expect(meanConfidence(items)).toBe(90);
  });

  it('closes the bitmap of a file whose recognition failed', async () => {
    loadBitmap.mockReset();
    recognizeImage.mockReset();
    const opened = bitmap();
    loadBitmap.mockResolvedValueOnce(opened);
    recognizeImage.mockRejectedValueOnce(new Error('Recognition failed.'));

    const items = await ocrImages([file('a.png')], 'eng', undefined);
    expect(items[0]?.error).toBe('Recognition failed.');
    expect(opened.close).toHaveBeenCalledTimes(1);
  });

  it('still unwinds the whole batch when the user presses Stop', async () => {
    const { OcrCancelledError } = await import('../shared/tesseract-loader');
    loadBitmap.mockReset();
    recognizeImage.mockReset();
    loadBitmap.mockResolvedValue(bitmap());
    recognizeImage
      .mockResolvedValueOnce(recognised('First'))
      .mockRejectedValueOnce(new OcrCancelledError());

    await expect(
      ocrImages([file('a.png'), file('b.png'), file('c.png')], 'eng', undefined),
    ).rejects.toBeInstanceOf(OcrCancelledError);
    // Not four calls: Stop ends the run rather than turning into a per-file error row.
    expect(recognizeImage).toHaveBeenCalledTimes(2);
  });

  it('does not even decode the next file once the run has been stopped', async () => {
    const { OcrCancelledError, terminateOcr } = await import('../shared/tesseract-loader');
    loadBitmap.mockReset();
    recognizeImage.mockReset();
    loadBitmap.mockResolvedValue(bitmap());
    // Stop pressed while the first image was being read: the job it rejects is already over, so
    // only the loop's own check stands between the user and a full decode of image two.
    recognizeImage.mockImplementationOnce(async () => {
      await terminateOcr();
      return recognised('First');
    });

    await expect(
      ocrImages([file('a.png'), file('b.png'), file('c.png')], 'eng', undefined),
    ).rejects.toBeInstanceOf(OcrCancelledError);
    expect(loadBitmap).toHaveBeenCalledTimes(1);
    expect(recognizeImage).toHaveBeenCalledTimes(1);
  });

  it('gives up on the batch when the recogniser itself will not start', async () => {
    const { OcrLoadError } = await import('../shared/tesseract-loader');
    loadBitmap.mockReset();
    recognizeImage.mockReset();
    loadBitmap.mockResolvedValue(bitmap());
    recognizeImage.mockRejectedValue(new OcrLoadError('The English recogniser could not start.'));

    await expect(
      ocrImages([file('a.png'), file('b.png')], 'eng', undefined),
    ).rejects.toBeInstanceOf(OcrLoadError);
    expect(recognizeImage).toHaveBeenCalledTimes(1);
  });
});
