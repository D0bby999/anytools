import { describe, expect, it } from 'vitest';
import { PageRangeError, parsePageRange, toContiguousRuns } from './page-range';

const parse = (s: string, pageCount = 20) => parsePageRange(s, { pageCount });

describe('parsePageRange', () => {
  it('converts one-based input to zero-based indices', () => {
    // The single most likely defect in this file: the UI shows page 1, pdf-lib wants index 0.
    expect(parse('1')).toEqual([0]);
    expect(parse('20')).toEqual([19]);
  });

  it('expands ranges inclusively at both ends', () => {
    expect(parse('2-6')).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles a mixed list', () => {
    expect(parse('1-3, 7, 9-12')).toEqual([0, 1, 2, 6, 8, 9, 10, 11]);
  });

  it('reads a reversed range in the order meant', () => {
    expect(parse('5-2')).toEqual(parse('2-5'));
  });

  it('de-duplicates and sorts overlapping input', () => {
    expect(parse('7, 1-3, 2-4, 7')).toEqual([0, 1, 2, 3, 6]);
  });

  it('survives whitespace and stray commas people actually type', () => {
    expect(parse('  1 - 3 ,, 7 ,  ')).toEqual([0, 1, 2, 6]);
  });

  it('accepts en and em dashes an editor may substitute', () => {
    expect(parse('1–3')).toEqual([0, 1, 2]);
    expect(parse('1—3')).toEqual([0, 1, 2]);
  });

  it('rejects a page past the end, naming the real page count', () => {
    expect(() => parse('19-25', 20)).toThrow(/does not exist.*20 pages/s);
  });

  it('rejects page zero — pages are one-based to the user', () => {
    expect(() => parse('0')).toThrow(PageRangeError);
    expect(() => parse('0-3')).toThrow(/start at 1/i);
  });

  it('rejects empty input rather than returning nothing silently', () => {
    expect(() => parse('')).toThrow(PageRangeError);
    expect(() => parse('   ')).toThrow(PageRangeError);
    expect(() => parse(', ,')).toThrow(PageRangeError);
  });

  it('rejects nonsense with the offending part quoted', () => {
    expect(() => parse('1-3, abc')).toThrow(/"abc"/);
    expect(() => parse('1..3')).toThrow(PageRangeError);
    expect(() => parse('-5')).toThrow(PageRangeError);
  });

  it('handles a single-page document', () => {
    expect(parse('1', 1)).toEqual([0]);
    expect(() => parse('2', 1)).toThrow(/1 page\b/);
  });
});

describe('toContiguousRuns', () => {
  it('groups consecutive indices and breaks on a gap', () => {
    expect(toContiguousRuns([0, 1, 2, 6, 8, 9])).toEqual([[0, 1, 2], [6], [8, 9]]);
  });

  it('returns one run for a fully contiguous list', () => {
    expect(toContiguousRuns([3, 4, 5])).toEqual([[3, 4, 5]]);
  });

  it('handles empty input', () => {
    expect(toContiguousRuns([])).toEqual([]);
  });

  it('does not merge a run starting at 0 with a preceding nothing', () => {
    // Guards the `?? -2` sentinel: a naive `?? -1` would treat index 0 as contiguous.
    expect(toContiguousRuns([0])).toEqual([[0]]);
  });
});
