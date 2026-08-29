import { describe, expect, it } from 'vitest';
import { diffJson, summarize } from './logic';

describe('diffJson', () => {
  it('ignores key order and formatting', () => {
    const result = diffJson('{"a":1,"b":2}', '{\n  "b": 2,\n  "a": 1\n}');
    expect(result).toMatchObject({ ok: true, identical: true });
  });

  it('detects added/removed/changed keys', () => {
    const result = diffJson('{"a":1,"b":2,"c":3}', '{"a":1,"b":99,"d":4}');
    if (!result.ok) throw new Error('expected ok');
    expect(result.entries).toEqual([
      { path: '$.b', kind: 'changed', before: 2, after: 99 },
      { path: '$.c', kind: 'removed', before: 3 },
      { path: '$.d', kind: 'added', after: 4 },
    ]);
  });

  it('diffs nested structures with full paths', () => {
    const result = diffJson(
      '{"user":{"emails":[{"label":"home"},{"label":"work"}]}}',
      '{"user":{"emails":[{"label":"home"},{"label":"office"},{"label":"spam"}]}}',
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.entries).toEqual([
      { path: '$.user.emails[1].label', kind: 'changed', before: 'work', after: 'office' },
      { path: '$.user.emails[2]', kind: 'added', after: { label: 'spam' } },
    ]);
  });

  it('flags type changes instead of descending', () => {
    const result = diffJson('{"a":[1,2]}', '{"a":{"0":1}}');
    if (!result.ok) throw new Error('expected ok');
    expect(result.entries).toEqual([
      { path: '$.a', kind: 'type-changed', before: [1, 2], after: { '0': 1 } },
    ]);
  });

  it('treats null vs value as a type change', () => {
    const result = diffJson('{"a":null}', '{"a":5}');
    if (!result.ok) throw new Error('expected ok');
    expect(result.entries[0]).toMatchObject({ kind: 'type-changed' });
  });

  it('reports parse errors with the failing side', () => {
    expect(diffJson('{bad', '{}')).toMatchObject({ ok: false, side: 'left' });
    expect(diffJson('{}', '[bad')).toMatchObject({ ok: false, side: 'right' });
  });

  it('diffs root primitives', () => {
    const result = diffJson('1', '2');
    if (!result.ok) throw new Error('expected ok');
    expect(result.entries).toEqual([{ path: '$', kind: 'changed', before: 1, after: 2 }]);
  });
});

describe('summarize', () => {
  it('counts by kind', () => {
    const result = diffJson('{"a":1,"b":2}', '{"b":3,"c":4}');
    if (!result.ok) throw new Error('expected ok');
    expect(summarize(result.entries)).toEqual({
      added: 1,
      removed: 1,
      changed: 1,
      'type-changed': 0,
    });
  });
});
