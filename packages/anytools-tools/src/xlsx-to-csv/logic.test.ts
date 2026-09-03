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
import { formatCellValue, jsonKeys, readWorkbookBuffer, toCsv, toJson, toRecords } from './logic';

async function buildWorkbook(): Promise<ArrayBuffer> {
  const mod = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();

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

  const written = await wb.xlsx.writeBuffer();
  const view = new Uint8Array(written as unknown as ArrayBufferLike);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
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
