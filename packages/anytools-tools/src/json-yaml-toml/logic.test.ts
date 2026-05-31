import { describe, expect, it } from 'vitest';
import { convertFormat, detectFormat, parseFormat, stringifyFormat } from './logic';

describe('convertFormat', () => {
  it('json → yaml', () => {
    const out = convertFormat('{"name":"foo","age":30}', 'json', 'yaml');
    expect(out).toContain('name: foo');
    expect(out).toContain('age: 30');
  });
  it('yaml → json', () => {
    const out = convertFormat('name: foo\nage: 30', 'yaml', 'json');
    expect(JSON.parse(out)).toEqual({ name: 'foo', age: 30 });
  });
  it('json → toml round-trips', () => {
    const original = { name: 'foo', age: 30, nested: { x: 1 } };
    const toml = convertFormat(JSON.stringify(original), 'json', 'toml');
    expect(JSON.parse(convertFormat(toml, 'toml', 'json'))).toEqual(original);
  });
  it('invalid json throws', () => {
    expect(() => convertFormat('{bad', 'json', 'yaml')).toThrow();
  });
});

describe('detectFormat', () => {
  it('json', () => expect(detectFormat('{"a":1}')).toBe('json'));
  it('json array', () => expect(detectFormat('[1,2]')).toBe('json'));
  it('yaml', () => expect(detectFormat('a:\n  - 1\n  - 2')).toBe('yaml'));
  it('toml', () => expect(detectFormat('name = "foo"')).toBe('toml'));
});
