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

/**
 * Refused before the file is even unzipped. A `.xlsx` is compressed XML, so 50 MB on disk
 * expands to something no tab can hold; letting it start only buys the user a frozen page
 * and then a crash with nothing to show for it.
 */
export const MAX_WORKBOOK_BYTES = 50 * 1024 * 1024;

/**
 * Hard ceiling on the cells one workbook may expand to, across all of its sheets.
 *
 * A sheet's width has to come from the cells that hold something, never from
 * `worksheet.columnCount`: that is the highest column index any cell object reaches, and one
 * value — or one leftover format — parked at column XFD makes it 16384 for the whole sheet.
 * Reading such a sheet by index took 31 seconds and 828 MB for 200 rows, and never finished
 * at 5000, from a 62 KB file. The used width below fixes that; this cap catches the case
 * where the far-right cell is real data and the sheet genuinely is that big.
 */
export const MAX_CELLS = 2_000_000;

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

/** Sheet names may contain anything a person can type; a download filename may not. */
export const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'sheet';

/** The zip itself is named after the workbook, so it needs the same flattening. */
export const workbookFileStem = (fileName: string | undefined): string =>
  safeName(fileName?.replace(/\.xlsx$/i, '') ?? 'workbook');

/**
 * Filenames for the "download all sheets" zip, one per sheet, in the same order.
 *
 * `safeName` is lossy on purpose, so it collides: "Q1/2026" and "Q1 2026" both flatten to
 * "Q1_2026", and the second entry written under that name replaces the first — a zip that
 * quietly holds fewer sheets than the workbook did. Compared case-insensitively because
 * Windows and macOS merge "Data" and "data" on extraction even though the zip format does not.
 */
export function zipEntryNames(sheetNames: string[]): string[] {
  const taken = new Set<string>();
  return sheetNames.map((name) => {
    const base = safeName(name);
    let candidate = base;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base}-${n}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  });
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

/** Index after the last field that holds something, so trailing blanks are dropped. */
function usedLength(cells: string[]): number {
  for (let i = cells.length - 1; i >= 0; i--) if (cells[i] !== '') return i + 1;
  return 0;
}

/**
 * The rows of one sheet that carry a value, keyed by their real row number, plus the extent
 * of the used range.
 *
 * `row.values` is the load-bearing detail. It is a sparse array indexed by column number that
 * exceljs builds from the cells that actually exist, so reading it costs what the sheet holds
 * — unlike `row.getCell(c)` in a `1..columnCount` loop, which *creates* a cell object for
 * every column it walks past. Holes in it are the empty cells inside a row and must survive
 * as empty fields, or every value after a gap shifts one column left.
 */
function scanSheet(sheet: import('exceljs').Worksheet): {
  rowsByNumber: Map<number, string[]>;
  width: number;
  height: number;
} {
  const rowsByNumber = new Map<number, string[]>();
  let width = 0;
  let height = 0;

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values = row.values as unknown[];
    const cells: string[] = new Array(Math.max(values.length - 1, 0));
    for (let c = 1; c < values.length; c++) cells[c - 1] = formatCellValue(values[c]);

    // A row of nothing but blanks and formatting is not content: leaving it out here is what
    // trims the empty rows off the bottom. A blank row in the MIDDLE is still emitted, from
    // its row number, when the sheet is rebuilt below.
    const used = usedLength(cells);
    if (used === 0) return;

    rowsByNumber.set(rowNumber, cells.slice(0, used));
    if (used > width) width = used;
    if (rowNumber > height) height = rowNumber;
  });

  return { rowsByNumber, width, height };
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
  let budget = MAX_CELLS;

  workbook.eachSheet((sheet) => {
    const { rowsByNumber, width, height } = scanSheet(sheet);
    const cellCount = width * height;

    if (cellCount > budget) {
      throw new WorkbookError(
        `Sheet "${sheet.name}" covers ${width.toLocaleString('en')} columns by ${height.toLocaleString('en')} rows — ${cellCount.toLocaleString('en')} cells, past the ${MAX_CELLS.toLocaleString('en')} this tool will build in a browser tab. A sheet is usually this wide by accident: one value or one leftover format far to the right of the data stretches it. Select the columns and rows beyond your data in Excel, delete them, save, and try again.`,
      );
    }
    budget -= cellCount;

    const rows: string[][] = [];
    for (let r = 1; r <= height; r++) {
      const cells = rowsByNumber.get(r);
      const padded: string[] = new Array(width);
      for (let c = 0; c < width; c++) padded[c] = cells?.[c] ?? '';
      rows.push(padded);
    }
    sheets.push({ name: sheet.name, rows });
  });

  if (sheets.length === 0) throw new WorkbookError('This workbook has no sheets.');
  return sheets;
}

export async function readWorkbookFile(file: File): Promise<SheetData[]> {
  if (file.size > MAX_WORKBOOK_BYTES) {
    throw new WorkbookError(
      `This workbook is ${Math.round(file.size / 1024 / 1024)} MB. The limit is ${
        MAX_WORKBOOK_BYTES / 1024 / 1024
      } MB, because an .xlsx is compressed XML that expands several times over in memory and the tab would run out before it finished. Split the workbook, or delete the sheets you do not need, and try again.`,
    );
  }
  return readWorkbookBuffer(await file.arrayBuffer());
}
