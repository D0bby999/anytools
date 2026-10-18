import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

// fast-xml-parser drops comments unless commentPropName is set. An XML formatter
// that silently deletes the comments out of a config file is destroying the part
// a human wrote, so both the parser and every builder name them explicitly.
const COMMENT_PROP = '#comment';
// Same story for CDATA: without cdataPropName the wrapper is unwrapped and its
// contents get escaped, which changes what the document means.
const CDATA_PROP = '#cdata';

const PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  trimValues: false,
  commentPropName: COMMENT_PROP,
  cdataPropName: CDATA_PROP,
});

const BUILDER_INDENT2 = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  commentPropName: COMMENT_PROP,
  cdataPropName: CDATA_PROP,
  format: true,
  indentBy: '  ',
});

const BUILDER_INDENT4 = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  commentPropName: COMMENT_PROP,
  cdataPropName: CDATA_PROP,
  format: true,
  indentBy: '    ',
});

const BUILDER_MINIFY = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  commentPropName: COMMENT_PROP,
  cdataPropName: CDATA_PROP,
  format: false,
});

export function formatXml(xml: string, indent: 2 | 4): ParseResult<string> {
  const valid = validateXml(xml);
  if (!valid.ok) return valid;
  try {
    const parsed = PARSER.parse(xml);
    const builder = indent === 4 ? BUILDER_INDENT4 : BUILDER_INDENT2;
    return { ok: true, value: builder.build(parsed) as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Format failed' };
  }
}

export function minifyXml(xml: string): ParseResult<string> {
  const valid = validateXml(xml);
  if (!valid.ok) return valid;
  try {
    // Strip whitespace between tags (>...<) only. A blanket newline removal used to
    // follow, which joined "line1\nline2" inside a text node into "line1line2".
    const minified = xml.replace(/>\s+</g, '><').trim();
    return { ok: true, value: minified };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Minify failed' };
  }
}

export function validateXml(xml: string): ParseResult<true> {
  const result = XMLValidator.validate(xml);
  if (result === true) return { ok: true, value: true };
  return { ok: false, error: result.err.msg ?? 'Invalid XML' };
}
