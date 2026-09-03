// @vitest-environment node
/**
 * exceljs is a Node library first, so the whole read path runs here rather than only in the
 * browser lane: the workbook under test is BUILT with exceljs (`xlsx.writeBuffer`) and then
 * read back through the real `readWorkbookBuffer`. Nothing is mocked and nothing is re-declared
 * — a test that restates the serialiser and asserts against its own copy proves nothing.
 *
 * Every fixture cell exists because it is a shape that has silently produced wrong output
 * somewhere: a date that arrives as the serial 46264, a formula printed as `[object Object]`,
 * rich text collapsing to nothing, an unquoted comma splitting a column in two, and an empty
 * cell in the middle shifting every value after it one column left.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_WORKBOOK_BYTES,
  WorkbookError,
  formatCellValue,
  jsonKeys,
  readWorkbookBuffer,
  readWorkbookFile,
  toCsv,
  toJson,
  toRecords,
  workbookFileStem,
  zipEntryNames,
} from './logic';

/** exceljs writes a `Buffer`; the reader takes an `ArrayBuffer`. */
function toArrayBuffer(written: unknown): ArrayBuffer {
  const view = new Uint8Array(written as ArrayBufferLike);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

async function newWorkbook() {
  const mod = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  return new ExcelJS.Workbook();
}

async function buildWorkbook(): Promise<ArrayBuffer> {
  const wb = await newWorkbook();

  const data = wb.addWorksheet('Data');
  data.getCell('A1').value = 'name';
  data.getCell('B1').value = 'joined';
  data.getCell('C1').value = 'score';
  data.getCell('D1').value = 'note';

  // Rich text: two styled runs that must join back into one string.
  data.getCell('A2').value = { richText: [{ text: 'Ada ' }, { text: 'Lovelace' }] };
  data.getCell('B2').value = new Date(Date.UTC(2026, 8, 3));
  data.getCell('C2').value = 21;
  // A comma AND a double quote in the same field — the two things CSV quoting exists for.
  data.getCell('D2').value = 'Smith, "Bob"';

  // C3 is a formula with a cached result; B3 is deliberately left empty so the row has a
  // hole in the middle rather than at the end.
  data.getCell('A3').value = 'Grace';
  data.getCell('C3').value = { formula: 'C2*2', result: 42 };
  data.getCell('D3').value = 'plain';

  const notes = wb.addWorksheet('Notes');
  notes.getCell('A1').value = 'only';
  notes.getCell('A2').value = 'sheet two';

  return toArrayBuffer(await wb.xlsx.writeBuffer());
}

/**
 * A sheet of `rows` narrow data rows plus one cell parked at column 16384 (XFD) — the shape
 * that made `worksheet.columnCount` report 16384 and the old index loop materialise every
 * column of every row. `stray: 'value'` is real data out there; `stray: 'format'` is the
 * far commoner accident, a cell that carries only a style.
 */
async function buildWideWorkbook(rows: number, stray: 'value' | 'format'): Promise<ArrayBuffer> {
  const wb = await newWorkbook();
  const sheet = wb.addWorksheet('Data');
  sheet.addRow(['name', 'score', 'note']);
  for (let r = 2; r <= rows; r++) sheet.addRow([`n${r}`, r, 'x']);
  if (stray === 'value') sheet.getCell(1, 16384).value = 'edge';
  else sheet.getCell(1, 16384).font = { bold: true };
  return toArrayBuffer(await wb.xlsx.writeBuffer());
}

describe('formatCellValue', () => {
  it('renders a date cell as an ISO calendar date, not an Excel serial', () => {
    expect(formatCellValue(new Date(Date.UTC(2026, 8, 3)))).toBe('2026-09-03');
  });

  it('keeps the time part when a date cell carries one', () => {
    expect(formatCellValue(new Date(Date.UTC(2026, 8, 3, 14, 30, 5)))).toBe('2026-09-03T14:30:05');
  });

  it('takes the cached result of a formula, including a nested date or error', () => {
    expect(formatCellValue({ formula: 'C2*2', result: 42 })).toBe('42');
    expect(formatCellValue({ sharedFormula: 'C2', result: 7 })).toBe('7');
    expect(formatCellValue({ formula: 'TODAY()', result: new Date(Date.UTC(2026, 8, 3)) })).toBe(
      '2026-09-03',
    );
    expect(formatCellValue({ formula: 'A1/0', result: { error: '#DIV/0!' } })).toBe('#DIV/0!');
  });

  it('is blank for a formula the workbook stored with no cached result', () => {
    expect(formatCellValue({ formula: 'C2*2' })).toBe('');
  });

  it('joins the runs of a rich-text cell', () => {
    expect(formatCellValue({ richText: [{ text: 'Ada ' }, { text: 'Lovelace' }] })).toBe(
      'Ada Lovelace',
    );
  });

  it('shows the visible text of a hyperlink cell, not the target', () => {
    expect(formatCellValue({ text: 'site', hyperlink: 'https://example.com/' })).toBe('site');
  });

  it('maps empty, boolean and error cells without inventing text', () => {
    expect(formatCellValue(null)).toBe('');
    expect(formatCellValue(undefined)).toBe('');
    expect(formatCellValue(true)).toBe('true');
    expect(formatCellValue({ error: '#N/A' })).toBe('#N/A');
  });
});

describe('toCsv', () => {
  it('quotes only the fields that need it and doubles embedded quotes', () => {
    const csv = toCsv([['a', 'Smith, "Bob"', 'c']]);
    expect(csv).toBe('a,"Smith, ""Bob""",c');
  });

  it('separates records with CRLF, per RFC 4180', () => {
    expect(toCsv([['a'], ['b']])).toBe('a\r\nb');
  });

  it('quotes on the chosen delimiter only', () => {
    expect(toCsv([['a;b', 'c,d']], { delimiter: ';' })).toBe('"a;b";c,d');
    expect(toCsv([['a;b', 'c,d']], { delimiter: '\t' })).toBe('a;b\tc,d');
  });

  it('quotes fields with newlines or edge whitespace', () => {
    expect(toCsv([['two\nlines', ' padded ']])).toBe('"two\nlines"," padded "');
  });

  it('adds a BOM only when asked', () => {
    expect(toCsv([['a']], { bom: true }).charCodeAt(0)).toBe(0xfeff);
    expect(toCsv([['a']]).charCodeAt(0)).not.toBe(0xfeff);
  });

  it('quotes everything when quoteAll is set', () => {
    expect(toCsv([['a', 'b']], { quoteAll: true })).toBe('"a","b"');
  });
});

describe('jsonKeys / toRecords', () => {
  it('names blank header cells by position and disambiguates repeats', () => {
    expect(jsonKeys(['name', '', 'name'], 3)).toEqual(['name', 'column_2', 'name_2']);
  });

  it('uses the first row as keys and pads short rows', () => {
    expect(toRecords([['a', 'b'], ['1']], true)).toEqual([{ a: '1', b: '' }]);
  });

  it('falls back to positional keys when the first row is data', () => {
    expect(toRecords([['1', '2']], false)).toEqual([{ column_1: '1', column_2: '2' }]);
  });

  it('returns an empty array for an empty sheet', () => {
    expect(toRecords([], true)).toEqual([]);
  });
});

describe('readWorkbookBuffer', () => {
  it('reads every sheet, in order, with its name', async () => {
    const sheets = await readWorkbookBuffer(await buildWorkbook());
    expect(sheets.map((s) => s.name)).toEqual(['Data', 'Notes']);
  });

  it('flattens dates, formulas, rich text and the hole in the middle of a row', async () => {
    const [data] = await readWorkbookBuffer(await buildWorkbook());
    expect(data?.rows).toEqual([
      ['name', 'joined', 'score', 'note'],
      ['Ada Lovelace', '2026-09-03', '21', 'Smith, "Bob"'],
      // B3 was never written: it must stay an empty column, not close the gap.
      ['Grace', '', '42', 'plain'],
    ]);
  });

  it('serialises the read sheet to CSV that round-trips the awkward cells', async () => {
    const [data] = await readWorkbookBuffer(await buildWorkbook());
    const csv = toCsv(data?.rows ?? []);
    expect(csv.split('\r\n')[1]).toBe('Ada Lovelace,2026-09-03,21,"Smith, ""Bob"""');
    expect(csv).not.toMatch(/4626\d/); // the 2026-09-03 serial, if the Date were stringified
  });

  it('serialises the read sheet to JSON keyed by the header row', async () => {
    const [data] = await readWorkbookBuffer(await buildWorkbook());
    expect(JSON.parse(toJson(data?.rows ?? [], true))).toEqual([
      { name: 'Ada Lovelace', joined: '2026-09-03', score: '21', note: 'Smith, "Bob"' },
      { name: 'Grace', joined: '', score: '42', note: 'plain' },
    ]);
  });

  it('rejects a file that is not an xlsx container with a message naming xls and ods', async () => {
    const notAZip = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    await expect(readWorkbookBuffer(notAZip)).rejects.toThrow(/\.xls.*\.ods|ods.*xls/i);
  });
});

/**
 * The used range, which is not what exceljs calls `columnCount` or `rowCount`. Getting this
 * wrong is not a cosmetic bug: reading a 62 KB file by `columnCount` took 31 seconds and
 * 828 MB at 200 rows and never finished at 5000.
 */
describe('readWorkbookBuffer — used range', () => {
  it('ignores a stray format at column 16384 and reads a 5000-row sheet in well under a second', async () => {
    const buffer = await buildWideWorkbook(5000, 'format');
    const started = Date.now();
    const [data] = await readWorkbookBuffer(buffer);
    const elapsed = Date.now() - started;

    expect(data?.rows).toHaveLength(5000);
    // Three columns, not 16384: a cell holding only a style is not data.
    expect(data?.rows[0]).toHaveLength(3);
    expect(data?.rows[4999]).toEqual(['n5000', '5000', 'x']);
    expect(elapsed).toBeLessThan(2000);
  });

  it('reads a real value at column 16384 at its true width, quickly', async () => {
    const buffer = await buildWideWorkbook(100, 'value');
    const started = Date.now();
    const [data] = await readWorkbookBuffer(buffer);
    const elapsed = Date.now() - started;

    expect(data?.rows[0]).toHaveLength(16384);
    expect(data?.rows[0]?.[16383]).toBe('edge');
    expect(data?.rows[0]?.slice(0, 3)).toEqual(['name', 'score', 'note']);
    // A row without the far cell is padded, not ragged.
    expect(data?.rows[1]).toHaveLength(16384);
    expect(data?.rows[1]?.[16383]).toBe('');
    expect(elapsed).toBeLessThan(2000);
  });

  it('refuses — quickly — a sheet whose real used range is past the cell cap', async () => {
    const buffer = await buildWideWorkbook(5000, 'value');
    const started = Date.now();
    // 16,384 x 5,000 is 81.9 million cells. Building that array is the freeze this replaces.
    await expect(readWorkbookBuffer(buffer)).rejects.toBeInstanceOf(WorkbookError);
    await expect(readWorkbookBuffer(buffer)).rejects.toThrow(/2,000,000/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('trims trailing empty rows and columns but keeps the holes inside the data', async () => {
    const wb = await newWorkbook();
    const sheet = wb.addWorksheet('Data');
    sheet.getCell('A1').value = 'a';
    sheet.getCell('C1').value = 'c'; // B1 is a hole in the middle of a row
    sheet.getCell('A3').value = 'a3'; // row 2 is entirely blank, in the middle
    sheet.getCell('E1').value = ''; // trailing empty column
    sheet.getCell('A5').value = ''; // trailing empty row
    sheet.getCell('B6').font = { bold: true }; // formatting only, below the data

    const [data] = await readWorkbookBuffer(toArrayBuffer(await wb.xlsx.writeBuffer()));
    expect(data?.rows).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
      ['a3', '', ''],
    ]);
  });
});

describe('zipEntryNames', () => {
  it('keeps two sheets whose sanitised names collide', () => {
    // Both flatten to Q1_2026; without the suffix the second entry replaces the first and
    // the zip silently holds one sheet fewer than the workbook.
    expect(zipEntryNames(['Q1/2026', 'Q1 2026', 'Q1:2026'])).toEqual([
      'Q1_2026',
      'Q1_2026-2',
      'Q1_2026-3',
    ]);
  });

  it('treats names that differ only in case as a collision', () => {
    // A zip may hold both, but Windows and macOS merge them on extraction.
    expect(zipEntryNames(['Data', 'data'])).toEqual(['Data', 'data-2']);
  });

  it('still separates two sheets whose names are nothing but punctuation', () => {
    // Both collapse to a bare underscore, which is a legal filename — the point is only that
    // the second one does not overwrite the first.
    expect(zipEntryNames(['///', '***'])).toEqual(['_', '_-2']);
  });

  it('falls back to a name when there is nothing left at all', () => {
    expect(zipEntryNames([''])).toEqual(['sheet']);
  });

  it('leaves distinct names untouched', () => {
    expect(zipEntryNames(['Data', 'Notes'])).toEqual(['Data', 'Notes']);
  });
});

describe('workbookFileStem', () => {
  it('drops the extension and sanitises what is left', () => {
    expect(workbookFileStem('Q1/2026 report.xlsx')).toBe('Q1_2026_report');
    expect(workbookFileStem(undefined)).toBe('workbook');
  });
});

describe('readWorkbookFile', () => {
  it('refuses a workbook past the size limit before reading a byte of it', async () => {
    let read = false;
    const file = {
      size: MAX_WORKBOOK_BYTES + 1,
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(0);
      },
    } as unknown as File;

    await expect(readWorkbookFile(file)).rejects.toBeInstanceOf(WorkbookError);
    await expect(readWorkbookFile(file)).rejects.toThrow(/50 MB/);
    expect(read).toBe(false);
  });

  it('lets a workbook at the limit through to the parser', async () => {
    const file = {
      size: MAX_WORKBOOK_BYTES,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as File;
    // Empty bytes, so it fails as "not an xlsx" — which proves the size gate passed it on.
    await expect(readWorkbookFile(file)).rejects.toThrow(/could not be read as \.xlsx/);
  });
});
