import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  trimValues: false,
});

const BUILDER_INDENT2 = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  format: true,
  indentBy: '  ',
});

const BUILDER_INDENT4 = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  format: true,
  indentBy: '    ',
});

const BUILDER_MINIFY = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
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
    // Strip whitespace between tags (>...<), keep text content intact
    const minified = xml
      .replace(/>\s+</g, '><')
      .replace(/^\s+|\s+$/g, '')
      .replace(/\n/g, '');
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
