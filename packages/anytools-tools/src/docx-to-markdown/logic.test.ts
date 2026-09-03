/**
 * The document under test is BUILT here with `docx` (MIT, a devDependency kept for this) and
 * then read back through the real `convertDocxBuffer` — mammoth, turndown and the GFM plugin
 * all run for real. Nothing is stubbed and no expected Markdown is hand-written twice.
 *
 * Runs in the default happy-dom environment because `promoteTableHeaders` needs a DOMParser,
 * which is exactly what the browser gives it.
 *
 * The table in the fixture deliberately does NOT set `tableHeader` on its first row. That is
 * the ordinary Word document, and it is the case where turndown-plugin-gfm refuses the table
 * and emits raw `<table>` HTML instead of a GFM table.
 */
import { describe, expect, it } from 'vitest';
import {
  DocxError,
  convertDocxBuffer,
  htmlToGfmMarkdown,
  promoteTableHeaders,
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

describe('promoteTableHeaders', () => {
  it('turns the first row of a header-less table into th cells', () => {
    const out = promoteTableHeaders(
      '<table><tr><td>a</td><td>b</td></tr><tr><td>1</td></tr></table>',
    );
    expect(out).toContain('<th>a</th>');
    expect(out).toContain('<th>b</th>');
    // Only the first row: the body must stay data.
    expect(out).toContain('<td>1</td>');
  });

  it('leaves a table that already has a header row alone', () => {
    const out = promoteTableHeaders('<table><tr><th>a</th></tr><tr><td>1</td></tr></table>');
    expect(out.match(/<th>/g)).toHaveLength(1);
  });

  it('does not touch a table nested inside a cell of an already-headed table', () => {
    const out = promoteTableHeaders(
      '<table><tr><th>outer</th></tr><tr><td><table><tr><td>inner</td></tr></table></td></tr></table>',
    );
    expect(out).toContain('<th>inner</th>');
    expect(out.match(/<th>outer<\/th>/g)).toHaveLength(1);
  });
});

describe('htmlToGfmMarkdown', () => {
  it('writes a GFM table once the header row exists', async () => {
    const md = await htmlToGfmMarkdown(
      promoteTableHeaders(
        '<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>',
      ),
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
      promoteTableHeaders('<table><tr><td><p>a</p><p>b</p></td><td><p>c</p></td></tr></table>'),
    );
    expect(md).toContain('| a<br>b | c |');
    // A newline inside a row ends the row; there must not be one.
    expect(md.split('\n').filter((l) => l.startsWith('|'))).toHaveLength(2);
  });

  it('escapes a pipe inside cell text so it cannot invent a column', async () => {
    const md = await htmlToGfmMarkdown(
      promoteTableHeaders('<table><tr><td>a | b</td><td>c</td></tr></table>'),
    );
    expect(md).toContain(String.raw`| a \| b | c |`);
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
  });
});

describe('renderMarkdownPreview', () => {
  it('renders through the md-html tool so the preview matches that tool exactly', async () => {
    const html = await renderMarkdownPreview('## Hi\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n');
    expect(html).toContain('<h2>Hi</h2>');
    expect(html).toContain('<table>');
  });
});
