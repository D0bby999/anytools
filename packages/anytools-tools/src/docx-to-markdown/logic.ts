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

export type DocxConversion = {
  markdown: string;
  /** mammoth's HTML, after image handling and table-header promotion. */
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
 * GFM has no table without a header row, and turndown-plugin-gfm knows it: unless the first
 * row is a heading row it declines the table and turndown falls back to emitting raw `<table>`
 * HTML. Word only marks a row as a header when the author ticked "Repeat as header row", which
 * almost nobody does, so left alone most real tables come out as HTML.
 *
 * So the first row is promoted to `<th>` here. That is an assumption, and it is stated on the
 * page: a table whose first row is data gets that data as its header.
 */
export function promoteTableHeaders(html: string): string {
  // No DOM (a bare Node runtime) — leave the HTML alone rather than half-parsing it.
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');

  for (const table of Array.from(doc.querySelectorAll('table'))) {
    // `closest` rather than `:scope >`: the HTML parser inserts an implicit <tbody>, and a
    // table cell may itself contain a table whose rows must not be touched here.
    const firstRow = Array.from(table.querySelectorAll('tr')).find(
      (tr) => tr.closest('table') === table,
    );
    if (!firstRow) continue;
    const cells = Array.from(firstRow.children);
    if (cells.length === 0 || cells.some((c) => c.tagName === 'TH')) continue;

    for (const cell of cells) {
      if (cell.tagName !== 'TD') continue;
      const th = doc.createElement('th');
      for (const attr of Array.from(cell.attributes)) th.setAttribute(attr.name, attr.value);
      while (cell.firstChild) th.appendChild(cell.firstChild);
      cell.replaceWith(th);
    }
  }

  return doc.body.innerHTML;
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
  const html = promoteTableHeaders(withImages);

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
