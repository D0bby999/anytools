import { html as htmlBeautify } from 'js-beautify';

export type HtmlBeautifyOptions = {
  indentSize?: number;
  wrapLineLength?: number;
  preserveNewlines?: boolean;
  maxPreserveNewlines?: number;
  endWithNewline?: boolean;
};

export function beautifyHtml(input: string, options: HtmlBeautifyOptions = {}): string {
  if (!input.trim()) return '';
  return htmlBeautify(input, {
    indent_size: options.indentSize ?? 2,
    wrap_line_length: options.wrapLineLength ?? 0,
    preserve_newlines: options.preserveNewlines ?? true,
    max_preserve_newlines: options.maxPreserveNewlines ?? 2,
    end_with_newline: options.endWithNewline ?? false,
  });
}

// Elements whose whitespace IS the content, plus script/style where a "comment" is code.
const VERBATIM_BLOCKS = /<(pre|textarea|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

// Whitespace next to one of these never renders, so the run between two tags can go
// entirely. Between inline tags it renders as one space and must stay one space:
// `<b>b</b> <i>c</i>` is "b c", `<b>b</b><i>c</i>` is "bc".
const BLOCK_TAGS = new Set([
  'html',
  'head',
  'body',
  'title',
  'meta',
  'link',
  'base',
  'div',
  'p',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'nav',
  'main',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'br',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'colgroup',
  'col',
  'form',
  'fieldset',
  'legend',
  'figure',
  'figcaption',
  'blockquote',
  'address',
  'details',
  'summary',
  'dialog',
  'template',
  'noscript',
  'option',
  'optgroup',
  'select',
]);
const BETWEEN_TAGS = /(<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>)\s+(?=<\/?([a-zA-Z][a-zA-Z0-9-]*)\b)/g;

/** Conservative minify: drop comments, collapse whitespace, never change what renders. */
export function minifyHtml(input: string): string {
  if (!input.trim()) return '';
  // Verbatim blocks are masked as a pseudo-tag carrying the real tag name, so the
  // block-vs-inline rule above still sees `<pre …>` and drops the whitespace around it.
  const kept: string[] = [];
  const text = input.replace(VERBATIM_BLOCKS, (block, tag: string) => {
    kept.push(block);
    return `<${tag} \uE000${kept.length - 1}>`;
  });
  const restore = (s: string) =>
    s.replace(/<[a-z]+ \uE000(\d+)>/gi, (_m, i) => kept[Number(i)] ?? '');
  const minified = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(
      BETWEEN_TAGS,
      (match, tag: string, left: string, _r, offset: number, whole: string) => {
        // The lookahead is not part of `match`, so read the right-hand tag from the source.
        const right = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(whole.slice(offset + match.length));
        const inlineBoth =
          !BLOCK_TAGS.has(left.toLowerCase()) && !BLOCK_TAGS.has((right?.[1] ?? '').toLowerCase());
        return inlineBoth ? `${tag} ` : tag;
      },
    )
    .replace(/\s+/g, ' ')
    .trim();
  return restore(minified);
}
