import { describe, expect, it } from 'vitest';
import { formatXml, minifyXml, validateXml } from './logic';

describe('formatXml', () => {
  it('indents with 2 spaces', () => {
    const r = formatXml('<a><b>1</b></a>', 2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toContain('\n  <b>');
  });
  it('indents with 4 spaces', () => {
    const r = formatXml('<a><b>1</b></a>', 4);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toContain('\n    <b>');
  });
  it('preserves attributes', () => {
    const r = formatXml('<a id="x"><b/></a>', 2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toContain('id="x"');
  });
  it('rejects invalid XML', () => {
    const r = formatXml('<a><b></a>', 2);
    expect(r.ok).toBe(false);
  });
});

describe('minifyXml', () => {
  it('collapses whitespace', () => {
    const r = minifyXml('<a>\n  <b>1</b>\n</a>');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('<a><b>1</b></a>');
  });
  // Review 2026-09-05: "line1\nline2" inside a text node came out as "line1line2".
  it('keeps newlines that are inside text content', () => {
    const r = minifyXml('<a>line1\nline2</a>');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('<a>line1\nline2</a>');
  });
});

describe('validateXml', () => {
  it('valid', () => expect(validateXml('<a/>').ok).toBe(true));
  it('mismatched tag', () => expect(validateXml('<a></b>').ok).toBe(false));
});

describe('comments and CDATA survive a reformat', () => {
  // Both were being silently dropped: fast-xml-parser discards them unless
  // commentPropName and cdataPropName are set. An XML formatter that deletes the
  // comments out of a config file, or unwraps CDATA and escapes its contents, is
  // changing what the document means — and the FAQ claimed both were preserved.
  const withComments = '<config><!-- db --><db host="localhost"><port>5432</port></db></config>';

  it('keeps comments when formatting', () => {
    const out = formatXml(withComments, 2);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toContain('<!-- db -->');
  });

  it('keeps comments when minifying', () => {
    const out = minifyXml(withComments);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toContain('<!-- db -->');
  });

  it('keeps CDATA wrapped rather than unwrapping and escaping it', () => {
    const out = formatXml('<a><![CDATA[<b>raw</b>]]></a>', 2);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value).toContain('<![CDATA[<b>raw</b>]]>');
      expect(out.value).not.toContain('&lt;b&gt;');
    }
  });

  it('output is still valid XML afterwards', () => {
    const out = formatXml(withComments, 2);
    if (out.ok) expect(validateXml(out.value).ok).toBe(true);
  });
});
