import { describe, expect, it } from 'vitest';
import { csvToJson, flattenRecord, jsonToCsv, typeField } from './logic';

describe('csvToJson', () => {
  it('parses with header', () => {
    expect(csvToJson('name,age\nAlice,30\nBob,25')).toEqual([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]);
  });
  it('handles quoted fields with commas', () => {
    expect(csvToJson('a,b\n"Hello, World",2')).toEqual([{ a: 'Hello, World', b: 2 }]);
  });
  it('auto-detects tab delimiter', () => {
    const out = csvToJson('a\tb\n1\t2') as { a: number; b: number }[];
    expect(out[0]).toEqual({ a: 1, b: 2 });
  });
});

describe('jsonToCsv', () => {
  it('round-trip', () => {
    const original = [
      { name: 'A', age: 30 },
      { name: 'B', age: 25 },
    ];
    const csv = jsonToCsv(original);
    expect(csvToJson(csv)).toEqual(original);
  });
  it('escapes commas and quotes', () => {
    const csv = jsonToCsv([{ name: 'Hello, "World"' }]);
    expect(csv).toContain('"Hello, ""World"""');
  });
});

// Review 2026-09-05: dynamicTyping turned phone numbers and postcodes into different numbers.
describe('typeField', () => {
  it('keeps leading zeros, exponents, trailing zeros and huge integers as text', () => {
    expect(typeField('0912345678')).toBe('0912345678');
    expect(typeField('02134')).toBe('02134');
    expect(typeField('1e5')).toBe('1e5');
    expect(typeField('3.10')).toBe('3.10');
    expect(typeField('12345678901234567890')).toBe('12345678901234567890');
  });
  it('still types canonical numbers and booleans', () => {
    expect(typeField('30')).toBe(30);
    expect(typeField('-2')).toBe(-2);
    expect(typeField('0.5')).toBe(0.5);
    expect(typeField('0')).toBe(0);
    expect(typeField('TRUE')).toBe(true);
    expect(typeField('false')).toBe(false);
  });
  it('applies through csvToJson', () => {
    expect(csvToJson('name,phone,zip\nAn,0912345678,02134')).toEqual([
      { name: 'An', phone: '0912345678', zip: '02134' },
    ]);
  });
});

describe('jsonToCsv with nested and ragged records', () => {
  it('flattens nested objects into dotted columns and arrays into JSON', () => {
    expect(flattenRecord({ a: 1, b: { c: 2, d: { e: 3 } }, f: [1, 2], g: null })).toEqual({
      a: 1,
      'b.c': 2,
      'b.d.e': 3,
      f: '[1,2]',
      g: '',
    });
    expect(jsonToCsv([{ a: 1, b: { c: 2 } }])).toBe('a,b.c\r\n1,2');
  });
  it('keeps every column when records disagree on keys', () => {
    expect(jsonToCsv([{ a: 1 }, { b: 2 }])).toBe('a,b\r\n1,\r\n,2');
  });
});
