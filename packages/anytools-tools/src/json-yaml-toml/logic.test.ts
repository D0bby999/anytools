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
  // Review 2026-09-05: js-yaml read `2024-01-01` as a timestamp and JSON got an ISO datetime.
  it('keeps a YAML date as the string it was written as', () => {
    expect(JSON.parse(convertFormat('date: 2024-01-01\nflag: no', 'yaml', 'json'))).toEqual({
      date: '2024-01-01',
      flag: 'no',
    });
  });
  it('names the null key when TOML cannot represent it', () => {
    expect(() => convertFormat('{"a":{"b":null}}', 'json', 'toml')).toThrow(/"a\.b" is null/);
    expect(() => convertFormat('{"list":[1,null]}', 'json', 'toml')).toThrow(/"list\[1\]"/);
  });
});

describe('detectFormat', () => {
  it('json', () => expect(detectFormat('{"a":1}')).toBe('json'));
  it('json array', () => expect(detectFormat('[1,2]')).toBe('json'));
  it('yaml', () => expect(detectFormat('a:\n  - 1\n  - 2')).toBe('yaml'));
  it('toml', () => expect(detectFormat('name = "foo"')).toBe('toml'));
});
