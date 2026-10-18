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
  // Review 2026-09-05: the old minify rewrote what the page rendered.
  it('keeps the single space between inline elements', () => {
    expect(minifyHtml('<p>a <b>b</b> <i>c</i></p>')).toBe('<p>a <b>b</b> <i>c</i></p>');
    expect(minifyHtml('<span>a</span>\n<span>b</span>')).toBe('<span>a</span> <span>b</span>');
  });
  it('leaves pre, textarea, script and style content verbatim', () => {
    expect(minifyHtml('<pre>a\n  b</pre>\n<p>x   y</p>')).toBe('<pre>a\n  b</pre><p>x y</p>');
    expect(minifyHtml('<textarea>a\n\n  b</textarea>')).toBe('<textarea>a\n\n  b</textarea>');
    expect(minifyHtml('<script>// keep\nlet a  = 1;</script>')).toBe(
      '<script>// keep\nlet a  = 1;</script>',
    );
  });
  it('empty input returns empty', () => {
    expect(minifyHtml('')).toBe('');
  });
});
