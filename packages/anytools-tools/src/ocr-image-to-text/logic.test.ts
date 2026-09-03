/**
 * The formatting and aggregation this tool does AFTER tesseract returns.
 *
 * Recognition itself needs a canvas, a WebAssembly worker and 4 MB of language data, none of
 * which exist under happy-dom — that half is verified in the browser lane (see the Verify
 * section of plans/…/phase-06-ocr.md). What is tested here is everything that decides what the
 * user actually sees: how a block tree becomes text, and how confidence is summarised.
 */
import { describe, expect, it } from 'vitest';
import type { OcrBlock } from '../shared/tesseract-loader';
import { combineText, countWords, formatOcrText, meanConfidence, textFileName } from './logic';

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
