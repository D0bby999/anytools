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
    if (r.ok) expect(r.value).not.toContain('\n');
  });
});

describe('validateXml', () => {
  it('valid', () => expect(validateXml('<a/>').ok).toBe(true));
  it('mismatched tag', () => expect(validateXml('<a></b>').ok).toBe(false));
});
