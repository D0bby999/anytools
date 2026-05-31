import { describe, expect, it } from 'vitest';
import { convertAllCases, convertCase } from './logic';

describe('convertCase', () => {
  it('camel', () => expect(convertCase('hello world', 'camel')).toBe('helloWorld'));
  it('pascal', () => expect(convertCase('hello world', 'pascal')).toBe('HelloWorld'));
  it('snake', () => expect(convertCase('Hello World', 'snake')).toBe('hello_world'));
  it('kebab', () => expect(convertCase('Hello World', 'kebab')).toBe('hello-world'));
  it('constant', () => expect(convertCase('Hello World', 'constant')).toBe('HELLO_WORLD'));
  it('handles acronyms', () =>
    expect(convertCase('XMLHttpRequest', 'snake')).toBe('xml_http_request'));
});

describe('convertAllCases', () => {
  it('produces all variants', () => {
    const out = convertAllCases('hello world');
    expect(out.camel).toBe('helloWorld');
    expect(out.snake).toBe('hello_world');
    expect(Object.keys(out).length).toBeGreaterThan(10);
  });
});
