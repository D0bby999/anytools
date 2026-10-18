import { describe, expect, it } from 'vitest';
import { exportAs, generateMockData } from './logic';

describe('generateMockData', () => {
  it('produces requested count', () => {
    const rows = generateMockData([{ name: 'id', type: 'uuid' }], 5);
    expect(rows).toHaveLength(5);
  });
  it('respects field types', () => {
    const rows = generateMockData(
      [
        { name: 'id', type: 'uuid' },
        { name: 'email', type: 'email' },
        { name: 'age', type: 'number', min: 18, max: 80 },
      ],
      3,
    );
    for (const r of rows) {
      expect(r.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(r.email).toMatch(/@/);
      expect(r.age).toBeGreaterThanOrEqual(18);
      expect(r.age).toBeLessThanOrEqual(80);
    }
  });
  it('clamps count to safe bounds', () => {
    expect(generateMockData([{ name: 'x', type: 'word' }], 2000)).toHaveLength(1000);
  });
});

describe('exportAs', () => {
  const rows = [
    { id: 1, name: 'Hello, World' },
    { id: 2, name: 'Quote "X"' },
  ];
  it('json', () => {
    expect(JSON.parse(exportAs(rows, 'json'))).toEqual(rows);
  });
  it('csv escapes commas and quotes', () => {
    const csv = exportAs(rows, 'csv');
    expect(csv).toContain('"Hello, World"');
    expect(csv).toContain('"Quote ""X"""');
  });
  it('sql escapes single quotes', () => {
    const sql = exportAs([{ id: 1, name: "O'Reilly" }], 'sql');
    expect(sql).toContain("'O''Reilly'");
    expect(sql).toContain('INSERT INTO mock_data');
  });
});
