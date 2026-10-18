// @vitest-environment node
/**
 * Runs the REAL sql.js library end to end — `loadSqlJs()` with no `wasmBasePath` override takes
 * sql.js's own Node default, which reads `sql-wasm.wasm` straight off disk (no fetch, no
 * browser). Same WASM binary and JS surface the browser UI uses; only the byte-loading path
 * differs (verified separately by the mandatory browser lane in the phase file's Verify section).
 */
import { describe, expect, it } from 'vitest';
import { ToolError } from '../shared/tool-error';
import {
  MAX_DB_BYTES,
  createDatabase,
  execSql,
  exportDatabaseBytes,
  importCsvAsTable,
  listTables,
  loadSqlJs,
  queryResultToCsv,
  queryResultToJson,
  validateDbFileSize,
} from './logic';

describe('execSql + listTables', () => {
  it('creates a table, inserts, queries, and lists it back with columns', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const created = execSql(db, 'CREATE TABLE users (id INTEGER, name TEXT)');
    expect(created).toEqual({ ok: true, results: [] });

    const inserted = execSql(db, "INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob')");
    expect(inserted.ok).toBe(true);

    const selected = execSql(db, 'SELECT * FROM users ORDER BY id');
    expect(selected).toEqual({
      ok: true,
      results: [
        {
          columns: ['id', 'name'],
          rows: [
            [1, 'Alice'],
            [2, 'Bob'],
          ],
        },
      ],
    });

    const tables = listTables(db);
    expect(tables).toEqual([
      {
        name: 'users',
        columns: [
          { name: 'id', type: 'INTEGER' },
          { name: 'name', type: 'TEXT' },
        ],
      },
    ]);
    db.close();
  });

  it("never swallows SQLite's own error text on a bad statement", async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const result = execSql(db, 'SELEKT * FROM nope');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.toLowerCase()).toContain('syntax error');
    db.close();
  });

  it('round-trips through export() into a fresh database (upload → download parity)', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    execSql(db, 'CREATE TABLE t (a INTEGER)');
    execSql(db, 'INSERT INTO t VALUES (7)');
    const bytes = exportDatabaseBytes(db);
    db.close();

    const reopened = createDatabase(SQL, bytes);
    const result = execSql(reopened, 'SELECT a FROM t');
    expect(result).toEqual({ ok: true, results: [{ columns: ['a'], rows: [[7]] }] });
    reopened.close();
  });
});

describe('importCsvAsTable', () => {
  it('parses CSV, types numeric columns, and is queryable afterwards', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const outcome = importCsvAsTable(db, 'people', 'name,age\nAlice,30\nBob,25\n');
    expect(outcome).toEqual({ rowCount: 2, columns: ['name', 'age'] });

    const result = execSql(db, 'SELECT name, age FROM people WHERE age > 26');
    expect(result).toEqual({
      ok: true,
      results: [{ columns: ['name', 'age'], rows: [['Alice', 30]] }],
    });
    db.close();
  });

  it('rejects an empty table name without touching sql.js', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    expect(() => importCsvAsTable(db, '  ', 'a,b\n1,2\n')).toThrow(ToolError);
    db.close();
  });

  it('rejects a header-only CSV with no data rows', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    expect(() => importCsvAsTable(db, 't', 'a,b\n')).toThrow(ToolError);
    db.close();
  });
});

describe('export formatting', () => {
  const result = {
    columns: ['a', 'b'],
    rows: [
      [1, 'x,y'],
      [2, null],
    ],
  };

  it('queryResultToCsv quotes fields containing the delimiter and renders null as empty', () => {
    expect(queryResultToCsv(result)).toBe('a,b\n1,"x,y"\n2,');
  });

  it('queryResultToJson produces one object per row keyed by column name', () => {
    expect(JSON.parse(queryResultToJson(result))).toEqual([
      { a: 1, b: 'x,y' },
      { a: 2, b: null },
    ]);
  });
});

describe('validateDbFileSize', () => {
  it('accepts a size at the cap', () => {
    expect(() => validateDbFileSize(MAX_DB_BYTES)).not.toThrow();
  });

  it('throws a ToolError over the cap, naming the megabyte ceiling', () => {
    try {
      validateDbFileSize(MAX_DB_BYTES + 1);
      throw new Error('expected validateDbFileSize to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ToolError);
      expect((e as ToolError).code).toBe('dbTooLarge');
      expect((e as ToolError).message).toContain('50 MB');
    }
  });
});
