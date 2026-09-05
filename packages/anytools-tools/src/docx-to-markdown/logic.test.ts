/**
 * The document under test is BUILT here with `docx` (MIT, a devDependency kept for this) and
 * then read back through the real `convertDocxBuffer` — mammoth, turndown and the GFM plugin
 * all run for real. Nothing is stubbed and no expected Markdown is hand-written twice.
 *
 * Runs in the default happy-dom environment because `normaliseTables` needs a DOMParser,
 * which is exactly what the browser gives it.
 *
 * The table in the fixture deliberately does NOT set `tableHeader` on its first row. That is
 * the ordinary Word document, and it is the case where turndown-plugin-gfm refuses the table
 * and emits raw `<table>` HTML instead of a GFM table.
 */
import { describe, expect, it } from 'vitest';
import {
  DocxError,
  MAX_DOCX_BYTES,
  convertDocxBuffer,
  convertDocxFile,
  htmlToGfmMarkdown,
  normaliseTables,
  renderMarkdownPreview,
} from './logic';

/** 1x1 transparent PNG — the smallest thing Word will accept as an image. */
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function buildDocx(withImage: boolean): Promise<ArrayBuffer> {
  const {
    Document,
    ExternalHyperlink,
    HeadingLevel,
    ImageRun,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
  } = await import('docx');

  const cell = (text: string) => new TableCell({ children: [new Paragraph(text)] });

  const children: object[] = [
    new Paragraph({ text: 'Quarterly report', heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: 'Summary', heading: HeadingLevel.HEADING_2 }),
    new Paragraph({
      children: [
        new TextRun({ text: 'Revenue was up', bold: true }),
        new TextRun({ text: ' but margins were flat.', italics: true }),
      ],
    }),
    new Paragraph({ text: 'First finding', bullet: { level: 0 } }),
    new Paragraph({ text: 'Second finding', bullet: { level: 0 } }),
    new Paragraph({
      children: [
        new ExternalHyperlink({
          children: [new TextRun('Source data')],
          link: 'https://example.com/report',
        }),
      ],
    }),
    new Table({
      rows: [
        new TableRow({ children: [cell('Region'), cell('Revenue')] }),
        new TableRow({ children: [cell('North'), cell('120')] }),
      ],
    }),
  ];

  if (withImage) {
    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: 'png',
            data: Buffer.from(PNG_1PX, 'base64'),
            transformation: { width: 8, height: 8 },
          }),
        ],
      }),
    );
  }

  // biome-ignore lint/suspicious/noExplicitAny: docx's section children union is not exported
  const doc = new Document({ sections: [{ children: children as any }] });
  const buf = await Packer.toBuffer(doc);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * A Word table with real merged cells: the header merges two columns, and a body cell is
 * merged down two rows. This is the shape that used to collapse to a single column.
 */
async function buildMergedTableDocx(): Promise<ArrayBuffer> {
  const { Document, Packer, Paragraph, Table, TableCell, TableRow } = await import('docx');
  const cell = (text: string, opts: Record<string, number> = {}) =>
    new TableCell({ children: [new Paragraph(text)], ...opts });

  const doc = new Document({
    sections: [
      {
        children: [
          new Table({
            rows: [
              new TableRow({ children: [cell('Revenue', { columnSpan: 2 }), cell('Total')] }),
              new TableRow({
                children: [cell('North', { rowSpan: 2 }), cell('120'), cell('218')],
              }),
              new TableRow({ children: [cell('98'), cell('196')] }),
            ],
            // biome-ignore lint/suspicious/noExplicitAny: docx's section children union is not exported
          }) as any,
        ],
      },
    ],
  });
  const buf = await Packer.toBuffer(doc);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe('normaliseTables', () => {
  /** Cell texts per row, so a test can assert the grid rather than a blob of HTML. */
  function grid(html: string): string[][] {
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
    return Array.from(doc.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.children).map((c) => c.textContent ?? ''),
    );
  }

  it('turns the first row of a header-less table into th cells', () => {
    const out = normaliseTables('<table><tr><td>a</td><td>b</td></tr><tr><td>1</td></tr></table>');
    expect(out).toContain('<th>a</th>');
    expect(out).toContain('<th>b</th>');
    // Only the first row: the body must stay data.
    expect(out).toContain('<td>1</td>');
  });

  it('leaves a table that already has a header row alone', () => {
    const out = normaliseTables('<table><tr><th>a</th></tr><tr><td>1</td></tr></table>');
    expect(out.match(/<th>/g)).toHaveLength(1);
  });

  it('does not touch a table nested inside a cell of an already-headed table', () => {
    const out = normaliseTables(
      '<table><tr><th>outer</th></tr><tr><td><table><tr><td>inner</td></tr></table></td></tr></table>',
    );
    expect(out).toContain('<th>inner</th>');
    expect(out.match(/<th>outer<\/th>/g)).toHaveLength(1);
  });

  it('expands a colspan header into one cell per column it covers', () => {
    const out = normaliseTables(
      '<table><tr><th colspan="2">Revenue</th><th>Total</th></tr>' +
        '<tr><td>Q1</td><td>Q2</td><td>218</td></tr></table>',
    );
    expect(grid(out)).toEqual([
      ['Revenue', '', 'Total'],
      ['Q1', 'Q2', '218'],
    ]);
    // The filler must stay a th, or the plugin stops recognising the heading row.
    expect(out).toContain('<th></th>');
    expect(out).not.toContain('colspan');
  });

  it('carries a rowspan down as an empty cell in each row it covers', () => {
    const out = normaliseTables(
      '<table><tr><th>Region</th><th>Quarter</th><th>Revenue</th></tr>' +
        '<tr><td rowspan="2">North</td><td>Q1</td><td>120</td></tr>' +
        '<tr><td>Q2</td><td>98</td></tr></table>',
    );
    expect(grid(out)).toEqual([
      ['Region', 'Quarter', 'Revenue'],
      ['North', 'Q1', '120'],
      // The covered slot keeps North's column; Q2 does not slide left into it.
      ['', 'Q2', '98'],
    ]);
    expect(out).not.toContain('rowspan');
  });

  it('places a cell in the first free slot, so a rowspan pushes later cells right', () => {
    const out = normaliseTables(
      '<table><tr><td>a</td><td rowspan="2">b</td><td>c</td></tr><tr><td>d</td><td>e</td></tr></table>',
    );
    expect(grid(out)).toEqual([
      ['a', 'b', 'c'],
      ['d', '', 'e'],
    ]);
  });

  it('leaves an absurd colspan unexpanded rather than building the grid it asks for', () => {
    const out = normaliseTables('<table><tr><td colspan="90000">x</td></tr></table>');
    expect(grid(out)[0]).toHaveLength(1);
    // Still spanning, which is what sends it down the raw-HTML path.
    expect(out).toContain('colspan');
  });
});

describe('htmlToGfmMarkdown', () => {
  it('writes a GFM table once the header row exists', async () => {
    const md = await htmlToGfmMarkdown(
      normaliseTables('<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>'),
    );
    expect(md).toContain('| a | b |');
    expect(md).toContain('| 1 | 2 |');
  });

  it('uses ATX headings and a hyphen bullet', async () => {
    expect(await htmlToGfmMarkdown('<h2>Hi</h2>')).toContain('## Hi');
    expect(await htmlToGfmMarkdown('<ul><li>x</li></ul>')).toMatch(/^-\s+x$/m);
  });

  it('keeps a cell on one line when Word wrapped its text in paragraphs', async () => {
    const md = await htmlToGfmMarkdown(
      normaliseTables('<table><tr><td><p>a</p><p>b</p></td><td><p>c</p></td></tr></table>'),
    );
    expect(md).toContain('| a<br>b | c |');
    // A newline inside a row ends the row; there must not be one.
    expect(md.split('\n').filter((l) => l.startsWith('|'))).toHaveLength(2);
  });

  it('escapes a pipe inside cell text so it cannot invent a column', async () => {
    const md = await htmlToGfmMarkdown(
      normaliseTables('<table><tr><td>a | b</td><td>c</td></tr></table>'),
    );
    expect(md).toContain(String.raw`| a \| b | c |`);
  });

  it('keeps every column of a colspan header, separator included', async () => {
    const md = await htmlToGfmMarkdown(
      normaliseTables(
        '<table><tr><th colspan="2">Revenue</th><th>Total</th></tr>' +
          '<tr><td>120</td><td>98</td><td>218</td></tr></table>',
      ),
    );
    expect(md).toContain('| Revenue |  | Total |');
    expect(md).toContain('| --- | --- | --- |');
    // Every number survives: collapsing the header to one column used to drop 98 and 218.
    expect(md).toContain('| 120 | 98 | 218 |');
  });

  it('keeps the columns aligned under a rowspan', async () => {
    const md = await htmlToGfmMarkdown(
      normaliseTables(
        '<table><tr><th>Region</th><th>Quarter</th><th>Revenue</th></tr>' +
          '<tr><td rowspan="2">North</td><td>Q1</td><td>120</td></tr>' +
          '<tr><td>Q2</td><td>98</td></tr></table>',
      ),
    );
    expect(md).toContain('| North | Q1 | 120 |');
    expect(md).toContain('|  | Q2 | 98 |');
  });

  it('emits a table containing a nested table as HTML rather than broken pipes', async () => {
    const md = await htmlToGfmMarkdown(
      normaliseTables(
        '<table><tr><td>outer</td><td><table><tr><td>inner</td></tr></table></td></tr></table>',
      ),
    );
    expect(md).toContain('<table>');
    // Nothing is lost on the way — the HTML still carries both tables' text.
    expect(md).toContain('outer');
    expect(md).toContain('inner');
    expect(md).not.toMatch(/^\|/m);
  });

  it('emits a table whose spans were too large to expand as HTML', async () => {
    const md = await htmlToGfmMarkdown(
      normaliseTables(
        '<table><tr><td colspan="90000">x</td><td>y</td></tr><tr><td>z</td></tr></table>',
      ),
    );
    expect(md).toContain('<table');
    expect(md).toContain('colspan="90000"');
  });
});

describe('convertDocxBuffer', () => {
  it('maps Word styles to headings, emphasis, lists and links', async () => {
    const { markdown } = await convertDocxBuffer(await buildDocx(false));
    expect(markdown).toContain('# Quarterly report');
    expect(markdown).toContain('## Summary');
    expect(markdown).toContain('**Revenue was up**');
    expect(markdown).toMatch(/_ ?but margins were flat\._/);
    expect(markdown).toMatch(/^-\s+First finding$/m);
    expect(markdown).toMatch(/^-\s+Second finding$/m);
    expect(markdown).toContain('[Source data](https://example.com/report)');
  });

  it('writes a two-column GFM table for a Word table with no marked header row', async () => {
    const { markdown } = await convertDocxBuffer(await buildDocx(false));
    // Not raw HTML: the whole point of promoting the header row.
    expect(markdown).not.toContain('<table>');

    const rows = markdown.split('\n').filter((l) => l.trim().startsWith('|'));
    expect(rows.length).toBeGreaterThanOrEqual(3); // header, separator, one body row
    const columnsIn = (row: string) =>
      row
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|').length;
    expect(columnsIn(rows[0] ?? '')).toBe(2);
    expect(rows[0]).toContain('Region');
    expect(rows[0]).toContain('Revenue');
    expect(columnsIn(rows[2] ?? '')).toBe(2);
    expect(rows[2]).toContain('North');
  });

  it('also returns the cleaned HTML mammoth produced', async () => {
    const { html } = await convertDocxBuffer(await buildDocx(false));
    expect(html).toContain('<h1>Quarterly report</h1>');
    expect(html).toContain('<strong>Revenue was up</strong>');
  });

  it('drops embedded images by default and counts them', async () => {
    const { markdown, html, imageCount } = await convertDocxBuffer(await buildDocx(true));
    expect(imageCount).toBe(1);
    expect(html).not.toContain('<img');
    expect(markdown).not.toContain('data:image');
    expect(markdown).not.toContain('![');
  });

  it('embeds images as data URIs when asked', async () => {
    const { markdown, imageCount } = await convertDocxBuffer(await buildDocx(true), {
      includeImages: true,
    });
    expect(imageCount).toBe(1);
    expect(markdown).toContain('data:image/png;base64,');
  });

  it('rejects a file that is not a docx with a message naming .doc and .odt', async () => {
    const notAZip = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    await expect(convertDocxBuffer(notAZip)).rejects.toBeInstanceOf(DocxError);
    await expect(convertDocxBuffer(notAZip)).rejects.toThrow(/\.doc\b[\s\S]*\.odt/);
    await expect(convertDocxBuffer(notAZip)).rejects.toMatchObject({ code: 'notDocx' });
  });

  it('keeps every cell of a Word table with merged header and body cells', async () => {
    const { markdown } = await convertDocxBuffer(await buildMergedTableDocx());
    const rows = markdown.split('\n').filter((l) => l.trim().startsWith('|'));
    const columnsIn = (row: string) =>
      row
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|').length;

    // Header, separator, two body rows — all three columns wide, none collapsed.
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(columnsIn(row)).toBe(3);
    expect(rows[0]).toContain('Revenue');
    expect(rows[0]).toContain('Total');
    // The numbers past the merged header used to vanish entirely.
    for (const value of ['North', '120', '218', '98', '196']) {
      expect(markdown).toContain(value);
    }
    expect(markdown).not.toContain('<table');
  });
});

describe('convertDocxFile', () => {
  const fakeFile = (size: number) =>
    ({ size, arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as File;

  it('refuses a document past the size limit before reading a byte of it', async () => {
    let read = false;
    const file = {
      size: MAX_DOCX_BYTES + 1,
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(0);
      },
    } as unknown as File;
    await expect(convertDocxFile(file)).rejects.toBeInstanceOf(DocxError);
    await expect(convertDocxFile(file)).rejects.toThrow(/50 MB/);
    await expect(convertDocxFile(file)).rejects.toMatchObject({
      code: 'tooLarge',
      params: { size: 50, max: 50 },
    });
    expect(read).toBe(false);
  });

  it('lets a document at the limit through to the parser', async () => {
    // Empty bytes, so it fails as "not a docx" — which proves the size gate passed it on.
    await expect(convertDocxFile(fakeFile(MAX_DOCX_BYTES))).rejects.toThrow(/could not be read/);
  });
});

describe('renderMarkdownPreview', () => {
  it('renders through the md-html tool so the preview matches that tool exactly', async () => {
    const html = await renderMarkdownPreview('## Hi\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n');
    expect(html).toContain('<h2>Hi</h2>');
    expect(html).toContain('<table>');
  });
});
