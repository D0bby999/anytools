import { describe, expect, it } from 'vitest';
import { beautifyCss, minifyCss } from './logic';

describe('beautifyCss', () => {
  it('formats rules with indent', () => {
    const out = beautifyCss('.a{color:red;font-size:14px;}');
    expect(out).toContain('.a {');
    expect(out).toContain('  color: red;');
  });
  it('respects custom indent', () => {
    const out = beautifyCss('.a{color:red}', { indentSize: 4 });
    expect(out).toContain('    color: red');
  });
  it('empty input returns empty', () => {
    expect(beautifyCss('')).toBe('');
  });
});

describe('minifyCss', () => {
  it('strips comments', () => {
    expect(minifyCss('.a{/* hide */color:red}')).toBe('.a{color:red}');
  });
  it('collapses whitespace around operators', () => {
    expect(minifyCss('.a , .b { color : red ; }')).toBe('.a,.b{color:red}');
  });
  it('drops trailing semicolons before }', () => {
    expect(minifyCss('.a { color: red; }')).toBe('.a{color:red}');
  });
  it('empty input returns empty', () => {
    expect(minifyCss('')).toBe('');
  });
  // Review 2026-09-05: calc(1px+2px) is invalid CSS, and "x; y" is content.
  it('keeps the spaces calc() needs around + and -', () => {
    expect(minifyCss('a { width: calc(100% - 10px); height: calc(1px + 2px); }')).toBe(
      'a{width:calc(100% - 10px);height:calc(1px + 2px)}',
    );
  });
  it('leaves string literals and url() bodies untouched', () => {
    expect(minifyCss('a::before { content: "x; y, z"; }')).toBe('a::before{content:"x; y, z"}');
    expect(minifyCss('a { background: url( data:image/png;base64,AA ); }')).toBe(
      'a{background:url( data:image/png;base64,AA )}',
    );
  });
});
