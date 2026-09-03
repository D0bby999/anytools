/// <reference path="./office-libs.d.ts" />
/**
 * Turn a .docx into Markdown in the tab: mammoth reads the document, turndown writes the
 * Markdown, turndown-plugin-gfm supplies tables.
 *
 * mammoth is used rather than a raw OOXML walk because it maps Word's *styles* to semantics —
 * a paragraph styled "Heading 2" becomes an `<h2>`, not a bold line — and it is the only
 * widely used library that does. Its own `convertToMarkdown` is deprecated and cannot emit a
 * GFM table, which is the single thing people open this kind of tool for, so the pipeline goes
 * through HTML and hands that to turndown.
 *
 * Everything is loaded on demand: the mammoth browser bundle alone is around 700 KB.
 */

/** Above this the conversion blocks the tab noticeably. A warning, not a limit — see the UI. */
export const SLOW_DOCX_BYTES = 20 * 1024 * 1024;

/**
 * Refused before the zip is opened. A `.docx` is compressed XML plus compressed images, and
 * the HTML plus the Markdown plus the base64 of any embedded picture all live in the tab at
 * once; starting a file this size only buys a frozen page and then a crash.
 */
export const MAX_DOCX_BYTES = 50 * 1024 * 1024;

/**
 * Ceilings on the grid one table may be expanded to. `colspan="90000"` is five characters of
 * XML and, taken literally, ninety thousand DOM nodes in one row. A table past either bound is
 * left with its spans intact, which sends it down the raw-HTML path below rather than into a
 * GFM table that would be wrong. Word itself stops at 63 columns, so this is far past real.
 */
const MAX_TABLE_COLUMNS = 1_000;
const MAX_TABLE_CELLS = 20_000;

export type DocxConversion = {
  markdown: string;
  /** mammoth's HTML, after image handling and table normalisation. */
  html: string;
  /** mammoth's own notes — unrecognised styles, mostly. Worth showing, never fatal. */
  warnings: string[];
  imageCount: number;
};

export type DocxOptions = {
  /** Off by default: a photo becomes ~1.4 MB of base64 and makes the Markdown unreadable. */
  includeImages?: boolean;
};

export class DocxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocxError';
  }
}

/**
 * The rows of one table, excluding the rows of any table nested inside one of its cells.
 * `closest` rather than `:scope >` because the HTML parser inserts an implicit `<tbody>`.
 */
const ownRows = (table: Element): Element[] =>
  Array.from(table.querySelectorAll('tr')).filter((tr) => tr.closest('table') === table);

const cellsOf = (row: Element): Element[] =>
  Array.from(row.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH');

function spanOf(cell: Element, attribute: 'colspan' | 'rowspan', max: number): number {
  const raw = Number.parseInt(cell.getAttribute(attribute) ?? '1', 10);
  // HTML says rowspan="0" runs to the end of the section; a missing or nonsense value is one.
  if (!Number.isFinite(raw) || raw < 1) return attribute === 'rowspan' && raw === 0 ? max : 1;
  return Math.min(raw, max);
}

/**
 * Turn a table with merged cells into a plain rectangle of cells.
 *
 * A Markdown table has no merging: every row is the same number of `|`-separated fields, and
 * the fields line up by position. `<th colspan="2">` left alone therefore does not widen a
 * column — it makes the header one field where the body rows have two, and every renderer
 * then draws a one-column table and throws the rest of each row away.
 *
 * So each spanning cell is expanded into the cells it covers: the first keeps the text and
 * the rest are empty, both across a row (colspan) and down into the rows below (rowspan).
 * Cells are placed into the first free slot rather than at their index, which is the same
 * rule a browser lays a table out by, so a rowspan from an earlier row pushes later cells
 * right exactly as it does on screen.
 */
function expandTableSpans(doc: Document, table: Element): void {
  const rows = ownRows(table);
  if (rows.length === 0) return;

  type Slot = { cell: Element; origin: boolean };
  const grid: (Slot | undefined)[][] = rows.map(() => []);
  let width = 0;
  let spanned = false;

  for (let r = 0; r < rows.length; r++) {
    let c = 0;
    for (const cell of cellsOf(rows[r] as Element)) {
      while (grid[r]?.[c] !== undefined) c++;
      const colspan = spanOf(cell, 'colspan', Number.POSITIVE_INFINITY);
      const rowspan = spanOf(cell, 'rowspan', rows.length - r);
      if (colspan > 1 || rowspan > 1) spanned = true;

      // Checked before a single slot is written, so a nonsense span costs nothing. Bailing
      // leaves the spans in place, and a table that still has spans is emitted as HTML.
      const end = c + colspan;
      if (end > MAX_TABLE_COLUMNS || end * rows.length > MAX_TABLE_CELLS) return;

      for (let dr = 0; dr < rowspan; dr++) {
        const target = grid[r + dr];
        if (!target) break;
        for (let dc = 0; dc < colspan; dc++)
          target[c + dc] = { cell, origin: dr === 0 && dc === 0 };
      }
      c += colspan;
      if (c > width) width = c;
    }
  }

  // Nothing merged: leave the DOM exactly as mammoth wrote it.
  if (!spanned) return;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] as Element;
    // The tag the filler cells of this row take, so a header row stays entirely `<th>` —
    // turndown-plugin-gfm only recognises a heading row when every child of it is a `th`.
    const rowTag = cellsOf(row)[0]?.tagName.toLowerCase() ?? 'td';
    const rebuilt: Element[] = [];
    for (let c = 0; c < width; c++) {
      const slot = grid[r]?.[c];
      if (slot?.origin) {
        slot.cell.removeAttribute('colspan');
        slot.cell.removeAttribute('rowspan');
        rebuilt.push(slot.cell);
      } else {
        rebuilt.push(doc.createElement(slot ? slot.cell.tagName.toLowerCase() : rowTag));
      }
    }
    // Everything, not just the cells: a stray text node left at the front of a row would make
    // the plugin count it as the first child and misplace the leading `|`.
    while (row.firstChild) row.removeChild(row.firstChild);
    for (const cell of rebuilt) row.appendChild(cell);
  }
}

/**
 * GFM has no table without a header row, and turndown-plugin-gfm knows it: unless the first
 * row is a heading row it declines the table and turndown falls back to emitting raw `<table>`
 * HTML. Word only marks a row as a header when the author ticked "Repeat as header row", which
 * almost nobody does, so left alone most real tables come out as HTML.
 *
 * So the first row is promoted to `<th>` here. That is an assumption, and it is stated on the
 * page: a table whose first row is data gets that data as its header.
 */
function promoteHeaderRow(doc: Document, table: Element): void {
  const firstRow = ownRows(table)[0];
  if (!firstRow) return;
  const cells = cellsOf(firstRow);
  if (cells.length === 0 || cells.some((c) => c.tagName === 'TH')) return;

  for (const cell of cells) {
    const th = doc.createElement('th');
    for (const attr of Array.from(cell.attributes)) th.setAttribute(attr.name, attr.value);
    while (cell.firstChild) th.appendChild(cell.firstChild);
    cell.replaceWith(th);
  }
}

/**
 * Make every table in mammoth's HTML something a GFM table can represent: rectangular, and
 * with a header row. Runs once over one parsed document — the returned HTML is what both the
 * Markdown and the HTML output are made from.
 */
export function normaliseTables(html: string): string {
  // No DOM (a bare Node runtime) — leave the HTML alone rather than half-parsing it.
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');

  for (const table of Array.from(doc.querySelectorAll('table'))) {
    expandTableSpans(doc, table);
    promoteHeaderRow(doc, table);
  }

  return doc.body.innerHTML;
}

/**
 * A table GFM cannot hold, whatever is done to it: one containing another table (Markdown has
 * no nested table at all), or one whose rows still disagree on how many cells they have —
 * which after `expandTableSpans` means only a table too large to expand.
 *
 * Emitting these as HTML keeps every value. Forcing them into pipes would not.
 */
function isUnconvertibleTable(table: Element): boolean {
  if (table.querySelector('table')) return true;
  const counts = ownRows(table).map((row) => cellsOf(row).length);
  return counts.length === 0 || counts.some((n) => n !== counts[0]);
}

export async function htmlToGfmMarkdown(html: string): Promise<string> {
  const [{ default: TurndownService }, gfmModule] = await Promise.all([
    import('turndown'),
    import('turndown-plugin-gfm'),
  ]);
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  turndown.use(gfmModule.gfm ?? gfmModule.default.gfm);

  /**
   * Takes precedence over the plugin's table rule (turndown checks rules newest-first) for the
   * tables that cannot become GFM at all. The plugin already keeps a table whose first row is
   * not a heading row; this extends the same escape hatch to the two cases it does not cover.
   */
  turndown.addRule('unconvertibleTable', {
    filter: (node) => node.nodeName === 'TABLE' && isUnconvertibleTable(node),
    replacement: (_content, node) => `\n\n${(node as Element).outerHTML}\n\n`,
  });

  /**
   * Replaces the plugin's own cell rule (turndown checks rules newest-first).
   *
   * Two things the plugin does not do, both of which silently destroy a table:
   *  - mammoth wraps every cell's text in `<p>`, so the converted cell arrives as
   *    "\nRegion\n\n". A newline inside a row ends the row, and the table falls apart into
   *    stray text. Interior line breaks become `<br>`, which GFM allows inside a cell.
   *  - a literal `|` in cell text is a column separator unless escaped, so one address or
   *    one regex in a document silently adds a column to that row.
   */
  turndown.addRule('inlineTableCell', {
    filter: ['th', 'td'],
    replacement: (content, node) => {
      const text = content
        .trim()
        .replace(/\s*\n+\s*/g, '<br>')
        .replace(/\|/g, '\\|');
      const siblings = Array.from(node.parentNode?.childNodes ?? []).filter(
        (n) => n.nodeName === 'TH' || n.nodeName === 'TD',
      );
      // Only the first cell of a row opens it. Compared by identity rather than by index so
      // that whitespace text nodes between cells cannot shift the count.
      return `${siblings[0] === node ? '| ' : ' '}${text} |`;
    },
  });

  return turndown.turndown(html);
}

async function loadMammoth() {
  const mod = await import('mammoth/mammoth.browser.js');
  // Node's ESM loader gives the CommonJS bundle back under `default`; a bundler gives the
  // namespace. Take whichever is present instead of assuming.
  return mod.default ?? mod;
}

export async function convertDocxBuffer(
  data: ArrayBuffer,
  options: DocxOptions = {},
): Promise<DocxConversion> {
  const includeImages = options.includeImages ?? false;
  const mammoth = await loadMammoth();

  let imageCount = 0;
  const convertImage = mammoth.images.imgElement(async (image) => {
    imageCount += 1;
    if (!includeImages) return { src: '' };
    return { src: `data:${image.contentType};base64,${await image.readAsBase64String()}` };
  });

  let result: Awaited<ReturnType<typeof mammoth.convertToHtml>>;
  try {
    result = await mammoth.convertToHtml({ arrayBuffer: data }, { convertImage });
  } catch (e) {
    throw new DocxError(
      `This file could not be read as .docx. The older binary .doc, .rtf, .odt and Apple Pages formats are different files entirely — open one in Word, LibreOffice or Pages and save it as .docx first. (${
        e instanceof Error ? e.message : 'unknown error'
      })`,
    );
  }

  // Dropping images means removing the placeholder <img> elements the converter above left.
  // A regex is safe against mammoth's output specifically: it escapes attribute values, so no
  // `>` can appear inside one, and the src it just wrote is empty.
  const withImages = includeImages ? result.value : result.value.replace(/<img\b[^>]*>/g, '');
  const html = normaliseTables(withImages);

  return {
    markdown: await htmlToGfmMarkdown(html),
    html,
    warnings: result.messages.map((m) => m.message),
    imageCount,
  };
}

export async function convertDocxFile(
  file: File,
  options: DocxOptions = {},
): Promise<DocxConversion> {
  if (file.size > MAX_DOCX_BYTES) {
    throw new DocxError(
      `This document is ${Math.round(file.size / 1024 / 1024)} MB. The limit is ${
        MAX_DOCX_BYTES / 1024 / 1024
      } MB, because a .docx is compressed and the unzipped XML, the HTML and the Markdown all have to be held in the tab at once. Split the document, or save a copy with the images removed, and try again.`,
    );
  }
  return convertDocxBuffer(await file.arrayBuffer(), options);
}

/**
 * Render the Markdown back to HTML for the preview, reusing the md-html tool's converter
 * rather than adding a second Markdown parser to the bundle. Dynamic because it pulls in
 * `marked`, and because the preview is only ever needed after a conversion has run.
 */
export async function renderMarkdownPreview(markdown: string): Promise<string> {
  const { markdownToHtml } = await import('../md-html/logic');
  return markdownToHtml(markdown, { gfm: true });
}
