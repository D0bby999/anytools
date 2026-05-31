import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, markdownToHtml } from './logic';

describe('markdownToHtml', () => {
  it('basic heading + paragraph', () => {
    const out = markdownToHtml('# Hello\n\nWorld');
    expect(out).toContain('<h1>Hello</h1>');
    expect(out).toContain('<p>World</p>');
  });
  it('GFM table', () => {
    const out = markdownToHtml('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(out).toContain('<table>');
  });
  it('code block', () => {
    const out = markdownToHtml('```js\nconst x = 1;\n```');
    expect(out).toContain('<code');
  });
});

describe('htmlToMarkdown', () => {
  it('basic heading + paragraph', () => {
    const out = htmlToMarkdown('<h1>Hello</h1><p>World</p>');
    expect(out).toContain('# Hello');
    expect(out).toContain('World');
  });
  it('roundtrip preserves structure', () => {
    const md = '# Title\n\nSome **bold** text.';
    const html = markdownToHtml(md);
    const back = htmlToMarkdown(html);
    expect(back).toContain('Title');
    expect(back).toContain('**bold**');
  });
});
