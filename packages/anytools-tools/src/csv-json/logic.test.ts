import { describe, expect, it } from 'vitest';
import { csvToJson, jsonToCsv } from './logic';

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
