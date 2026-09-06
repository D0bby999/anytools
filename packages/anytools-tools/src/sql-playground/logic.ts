/// <reference path="./sql-js-ambient.d.ts" />
/**
 * SQLite-in-the-tab, on top of sql.js. `loadSqlJs`'s `wasmBasePath` is the same trick as
 * jq-playground/logic.ts: leaving it undefined lets sql.js fall back to its own Node default
 * (reads the binary off disk, no fetch) so logic.test.ts exercises the REAL library; the browser
 * UI always passes `/third-party/sqljs/` explicitly, because sql.js's browser default resolves
 * relative to its own bundled script location — not the pinned same-origin path this site's
 * `vendor-assets.test.ts` requires.
 *
 * sql.js ships no TypeScript types of its own (no `types` field, and this repo pins no
 * `@types/sql.js`), so `SqlJsStatic`/`SqlJsDatabase` below are hand-written from its README —
 * only the handful of methods this file actually calls, not the whole API.
 */
import { csvToJson } from '../csv-json/logic';
import { ToolError } from '../shared/tool-error';

export const SQLJS_WASM_BASE = '/third-party/sqljs/';
/** sql.js loads the whole file into memory; this is a tab-safety ceiling, not a format limit. */
export const MAX_DB_BYTES = 50 * 1024 * 1024;

export type SqlJsStatement = { run(params?: unknown[]): void; free(): void };
export type SqlJsDatabase = {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  prepare(sql: string): SqlJsStatement;
  export(): Uint8Array;
  close(): void;
};
export type SqlJsStatic = { Database: new (data?: Uint8Array) => SqlJsDatabase };

export type SqlColumn = { name: string; type: string };
export type SqlTable = { name: string; columns: SqlColumn[] };
export type SqlQueryResult = { columns: string[]; rows: unknown[][] };
export type SqlExecOutcome = { ok: true; results: SqlQueryResult[] } | { ok: false; error: string };

export async function loadSqlJs(wasmBasePath?: string): Promise<SqlJsStatic> {
  const mod = await import('sql.js');
  // No published types (see file header) — this is the module's one real entry point,
  // `initSqlJs(config?): Promise<SqlJsStatic>`, asserted to the shape this file uses.
  const initSqlJs = mod.default as (config?: {
    locateFile?: (file: string) => string;
  }) => Promise<SqlJsStatic>;
  return initSqlJs(wasmBasePath ? { locateFile: (file) => `${wasmBasePath}${file}` } : undefined);
}

export function createDatabase(SQL: SqlJsStatic, data?: Uint8Array): SqlJsDatabase {
  return new SQL.Database(data);
}

/** Throws before a File is even read into memory if it is over the cap. */
export function validateDbFileSize(bytes: number): void {
  if (bytes <= MAX_DB_BYTES) return;
  const mb = Math.round(MAX_DB_BYTES / (1024 * 1024));
  throw new ToolError(
    'dbTooLarge',
    `This database file is over ${mb} MB. sql.js loads the whole file into memory before it can run a single query, so a bigger one risks exhausting the tab. Try a smaller export.`,
    { mb },
  );
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Runs arbitrary SQL (possibly several `;`-separated statements) and returns every result set
 * a SELECT produced, in order. SQLite's own error text passes through unmodified. */
export function execSql(db: SqlJsDatabase, sql: string): SqlExecOutcome {
  try {
    const raw = db.exec(sql);
    return { ok: true, results: raw.map((r) => ({ columns: r.columns, rows: r.values })) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** User tables (never `sqlite_%`) with their columns, read from `sqlite_master` + `PRAGMA
 * table_info` — so the widget can show "what do I have" without the user writing that query. */
export function listTables(db: SqlJsDatabase): SqlTable[] {
  const names =
    db
      .exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )[0]
      ?.values.map((row) => String(row[0])) ?? [];
  return names.map((name) => {
    const info = db.exec(`PRAGMA table_info(${quoteIdent(name)})`)[0]?.values ?? [];
    const columns = info.map((row) => ({ name: String(row[1]), type: String(row[2] ?? '') }));
    return { name, columns };
  });
}

/** Parses CSV text (reusing csv-json's typed parser) and loads it as a fresh table, replacing
 * any existing table of the same name. Returns what landed, for the widget to report back. */
export function importCsvAsTable(
  db: SqlJsDatabase,
  tableName: string,
  csvText: string,
): { rowCount: number; columns: string[] } {
  const trimmedName = tableName.trim();
  if (trimmedName.length === 0) {
    throw new ToolError('tableNameEmpty', 'Give the imported table a name.', {});
  }
  const rows = csvToJson(csvText, { header: true }) as Record<string, unknown>[];
  if (rows.length === 0) {
    throw new ToolError('csvEmpty', 'The CSV has no data rows to import.', {});
  }
  const columns = Object.keys(rows[0] ?? {});
  const ident = quoteIdent(trimmedName);
  const colList = columns.map(quoteIdent).join(', ');
  db.run(`DROP TABLE IF EXISTS ${ident}`);
  db.run(`CREATE TABLE ${ident} (${colList})`);
  const stmt = db.prepare(
    `INSERT INTO ${ident} (${colList}) VALUES (${columns.map(() => '?').join(', ')})`,
  );
  try {
    for (const row of rows) stmt.run(columns.map((c) => (row[c] === undefined ? null : row[c])));
  } finally {
    stmt.free();
  }
  return { rowCount: rows.length, columns };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = value instanceof Uint8Array ? `<${value.length} bytes>` : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function queryResultToCsv(result: SqlQueryResult): string {
  return [result.columns.join(','), ...result.rows.map((row) => row.map(csvCell).join(','))].join(
    '\n',
  );
}

export function queryResultToJson(result: SqlQueryResult): string {
  const objects = result.rows.map((row) =>
    Object.fromEntries(result.columns.map((c, i) => [c, row[i]])),
  );
  return JSON.stringify(objects, null, 2);
}

export function exportDatabaseBytes(db: SqlJsDatabase): Uint8Array {
  return db.export();
}
