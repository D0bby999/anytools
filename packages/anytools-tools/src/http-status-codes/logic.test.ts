import { describe, expect, it } from 'vitest';
import { MIME_TYPES, STATUS_CODES, classOfCode, searchMimeTypes, searchStatusCodes } from './logic';

describe('STATUS_CODES data', () => {
  it('has unique codes, sorted ascending', () => {
    const codes = STATUS_CODES.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect([...codes].sort((a, b) => a - b)).toEqual(codes);
  });
  it('covers the essentials', () => {
    for (const code of [200, 201, 301, 304, 400, 401, 403, 404, 429, 500, 502, 503]) {
      expect(codes()).toContain(code);
    }
    function codes() {
      return STATUS_CODES.map((s) => s.code);
    }
  });
});

describe('searchStatusCodes', () => {
  it('matches by number, name, and description', () => {
    expect(searchStatusCodes('404')[0]?.name).toBe('Not Found');
    expect(searchStatusCodes('teapot')[0]?.code).toBe(418);
    expect(searchStatusCodes('rate limit')[0]?.code).toBe(429);
  });
  it('filters by class', () => {
    const only5xx = searchStatusCodes('', '5xx');
    expect(only5xx.length).toBeGreaterThan(0);
    expect(only5xx.every((s) => s.code >= 500 && s.code < 600)).toBe(true);
  });
  it('combines query and class filter', () => {
    expect(searchStatusCodes('gateway', '5xx').map((s) => s.code)).toEqual([502, 504]);
  });
});

describe('searchMimeTypes', () => {
  it('matches by extension and mime', () => {
    expect(searchMimeTypes('.webp')[0]?.mime).toBe('image/webp');
    expect(searchMimeTypes('octet')[0]?.extension).toBe('.bin');
  });
  it('returns everything on empty query', () => {
    expect(searchMimeTypes('')).toHaveLength(MIME_TYPES.length);
  });
});

describe('classOfCode', () => {
  it('buckets codes', () => {
    expect(classOfCode(204)).toBe('2xx');
    expect(classOfCode(451)).toBe('4xx');
  });
});
