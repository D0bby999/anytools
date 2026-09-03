/**
 * Read an .xlsx workbook in the tab and serialise one sheet to CSV or JSON.
 *
 * exceljs (MIT, on npm, integrity-pinned) reads only the OOXML `.xlsx` container — not the
 * old binary `.xls`, not `.ods`, not Numbers. That is a deliberate trade: the alternative
 * that reads all of them ships as a tarball from a vendor CDN with no integrity hash in the
 * lockfile, which every `pnpm install --frozen-lockfile` in CI would then have to trust.
 *
 * The serialisers are written here rather than taken from exceljs's own `csv.writeBuffer`,
 * which is built on Node streams and does not run in a browser.
 *
 * A cell value is not a string. exceljs hands back five shapes that all have to be flattened
 * before anything can be written, and getting one wrong is how a date column ships as `46264`.
 */

/** Above this the parse blocks the tab noticeably. A warning, not a limit — see the UI. */
export const SLOW_WORKBOOK_BYTES = 20 * 1024 * 1024;

export type SheetData = { name: string; rows: string[][] };
export type Delimiter = ',' | ';' | '\t';

export type CsvOptions = {
  delimiter?: Delimiter;
  /** Quote every field, not just the ones that need it. */
  quoteAll?: boolean;
  /** Prepend U+FEFF so Excel opens UTF-8 without mangling accents. */
  bom?: boolean;
};

export class WorkbookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbookError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * Excel stores a date as a number of days since 1900; exceljs turns that back into a `Date`
 * anchored at UTC. Reading it with local getters shifts the day for anyone west of Greenwich,
 * so every field below is the UTC one.
 */
function formatDate(d: Date): string {
  if (Number.isNaN(d.getTime())) return '';
  const iso = d.toISOString();
  // A plain date cell has no time part; keep it as YYYY-MM-DD rather than inventing midnight.
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19);
}

/**
 * Flatten one exceljs cell value to text.
 *
 * The shapes, in the order they are tested:
 *   `{ richText: [...] }`      styled text — join the runs, drop the styling.
 *   `{ error: '#DIV/0!' }`     an Excel error; show it rather than blanking the cell.
 *   `{ formula, result }`      a formula: the cached result is what Excel displays. Recursive,
 *                              because a result can itself be a Date or an error.
 *   `{ text, hyperlink }`      a link — the visible text, not the target.
 *   `Date`                     ISO, via formatDate above.
 */
export function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatDate(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (isRecord(value)) {
    if (Array.isArray(value.richText)) {
      return value.richText
        .map((run) => (isRecord(run) && typeof run.text === 'string' ? run.text : ''))
        .join('');
    }
    if ('error' in value) return String(value.error);
    // `result` is absent when the workbook was written without cached values; there is
    // nothing to show then, and printing the formula source would be worse than blank.
    if ('formula' in value || 'sharedFormula' in value) {
      return 'result' in value ? formatCellValue(value.result) : '';
    }
    if ('hyperlink' in value) return formatCellValue(value.text);
  }
  return String(value);
}

function quoteField(field: string, delimiter: string, quoteAll: boolean): string {
  const needed =
    quoteAll ||
    field.includes('"') ||
    field.includes('\n') ||
    field.includes('\r') ||
    field.includes(delimiter) ||
    field !== field.trim();
  return needed ? `"${field.replace(/"/g, '""')}"` : field;
}

/** Written as an escape on purpose: a literal U+FEFF in source is invisible to review. */
export const UTF8_BOM = '\uFEFF';

/** RFC 4180: CRLF between records, `""` for an embedded quote. */
export function toCsv(rows: string[][], options: CsvOptions = {}): string {
  const { delimiter = ',', quoteAll = false, bom = false } = options;
  const body = rows
    .map((row) => row.map((f) => quoteField(f, delimiter, quoteAll)).join(delimiter))
    .join('\r\n');
  return bom ? `${UTF8_BOM}${body}` : body;
}

/**
 * Column keys for the JSON view. Blank headers become `column_3` rather than `""`, and a
 * repeated header becomes `name_2` — a duplicate key would silently drop a whole column
 * when the records are stringified.
 */
export function jsonKeys(header: string[], width: number): string[] {
  const seen = new Map<string, number>();
  return Array.from({ length: width }, (_, i) => {
    const raw = (header[i] ?? '').trim();
    const base = raw === '' ? `column_${i + 1}` : raw;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}_${n + 1}`;
  });
}

export function toRecords(rows: string[][], firstRowAsKeys: boolean): Record<string, string>[] {
  if (rows.length === 0) return [];
  const width = Math.max(...rows.map((r) => r.length));
  const keys = jsonKeys(firstRowAsKeys ? (rows[0] ?? []) : [], width);
  const body = firstRowAsKeys ? rows.slice(1) : rows;
  return body.map((row) => Object.fromEntries(keys.map((k, i) => [k, row[i] ?? ''])));
}

export function toJson(rows: string[][], firstRowAsKeys: boolean): string {
  return JSON.stringify(toRecords(rows, firstRowAsKeys), null, 2);
}

type ExcelJsModule = typeof import('exceljs');

/**
 * ~1 MB of JavaScript, so it is loaded only once a workbook is actually dropped.
 *
 * Node's ESM loader cannot see exceljs's named exports through its CommonJS entry (only
 * `default` comes through), while a bundler hands back the namespace directly. Take whichever
 * is there instead of assuming one of them.
 */
async function loadExcelJs(): Promise<ExcelJsModule> {
  const mod = (await import('exceljs')) as ExcelJsModule & { default?: ExcelJsModule };
  return mod.default ?? mod;
}

export async function readWorkbookBuffer(data: ArrayBuffer): Promise<SheetData[]> {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data);
  } catch {
    throw new WorkbookError(
      'This file could not be read as .xlsx. Old .xls, .ods and Numbers files are different formats — open one in Excel, LibreOffice or Numbers and save it as .xlsx first.',
    );
  }

  const sheets: SheetData[] = [];
  workbook.eachSheet((sheet) => {
    const width = sheet.columnCount;
    const rows: string[][] = [];
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      // Indexed rather than `eachCell`, which skips empty cells and would shift every
      // value after a gap one column to the left.
      const cells: string[] = [];
      for (let c = 1; c <= width; c++) cells.push(formatCellValue(row.getCell(c).value));
      rows.push(cells);
    }
    sheets.push({ name: sheet.name, rows });
  });

  if (sheets.length === 0) throw new WorkbookError('This workbook has no sheets.');
  return sheets;
}

export async function readWorkbookFile(file: File): Promise<SheetData[]> {
  return readWorkbookBuffer(await file.arrayBuffer());
}
