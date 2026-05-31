import { describe, expect, it } from 'vitest';
import { beautifyHtml, minifyHtml } from './logic';

describe('beautifyHtml', () => {
  it('formats block-level tags with indent', () => {
    const out = beautifyHtml('<div><p>hello</p><p>world</p></div>');
    expect(out).toContain('<div>\n');
    expect(out).toContain('  <p>hello</p>');
    expect(out).toContain('  <p>world</p>');
  });
  it('respects custom indent size', () => {
    const out = beautifyHtml('<div><p>x</p></div>', { indentSize: 4 });
    expect(out).toContain('    <p>x</p>');
  });
  it('empty input returns empty', () => {
    expect(beautifyHtml('')).toBe('');
    expect(beautifyHtml('   ')).toBe('');
  });
});

describe('minifyHtml', () => {
  it('strips comments', () => {
    expect(minifyHtml('<div><!-- hide me --><span>x</span></div>')).toBe(
      '<div><span>x</span></div>',
    );
  });
  it('collapses whitespace between tags', () => {
    expect(minifyHtml('<div>\n  <span>x</span>\n</div>')).toBe('<div><span>x</span></div>');
  });
  it('collapses runs of whitespace inside text', () => {
    expect(minifyHtml('<p>hello   world</p>')).toBe('<p>hello world</p>');
  });
  it('empty input returns empty', () => {
    expect(minifyHtml('')).toBe('');
  });
});
