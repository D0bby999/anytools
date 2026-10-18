/**
 * Structural JSON diff — key-aware, order-insensitive for objects,
 * index-based for arrays. Unlike the text diff-checker tool, reformatting
 * or key reordering produces zero differences here.
 */
import { findUnsafeIntegers } from '../shared/json-unsafe-integers';

export type DiffKind = 'added' | 'removed' | 'changed' | 'type-changed';

export type DiffEntry = {
  path: string; // e.g. "user.emails[2].label", "$" for root
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
};

export type JsonDiffResult =
  | { ok: true; entries: DiffEntry[]; identical: boolean; unsafeIntegers: string[] }
  | { ok: false; error: string; side: 'left' | 'right' };

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeOf(v) === 'object';
}

function joinPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`;
  return parent === '$' ? `$.${key}` : `${parent}.${key}`;
}

function walk(path: string, before: unknown, after: unknown, out: DiffEntry[]): void {
  const tBefore = typeOf(before);
  const tAfter = typeOf(after);

  if (tBefore !== tAfter) {
    out.push({ path, kind: 'type-changed', before, after });
    return;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      const inBefore = Object.hasOwn(before, key);
      const inAfter = Object.hasOwn(after, key);
      if (!inBefore) out.push({ path: joinPath(path, key), kind: 'added', after: after[key] });
      else if (!inAfter)
        out.push({ path: joinPath(path, key), kind: 'removed', before: before[key] });
      else walk(joinPath(path, key), before[key], after[key], out);
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const max = Math.max(before.length, after.length);
    for (let i = 0; i < max; i++) {
      if (i >= before.length) out.push({ path: joinPath(path, i), kind: 'added', after: after[i] });
      else if (i >= after.length)
        out.push({ path: joinPath(path, i), kind: 'removed', before: before[i] });
      else walk(joinPath(path, i), before[i], after[i], out);
    }
    return;
  }

  // Primitives (or null) of the same type.
  if (!Object.is(before, after)) {
    out.push({ path, kind: 'changed', before, after });
  }
}

export function diffJson(leftText: string, rightText: string): JsonDiffResult {
  let left: unknown;
  let right: unknown;
  try {
    left = JSON.parse(leftText);
  } catch (e) {
    return { ok: false, side: 'left', error: e instanceof Error ? e.message : 'Invalid JSON' };
  }
  try {
    right = JSON.parse(rightText);
  } catch (e) {
    return { ok: false, side: 'right', error: e instanceof Error ? e.message : 'Invalid JSON' };
  }
  const entries: DiffEntry[] = [];
  walk('$', left, right, entries);
  // Two IDs that differ only past the 53rd bit parse to the same double and diff as
  // identical; surface the literals so the reader knows the comparison is lossy there.
  const unsafeIntegers = [
    ...new Set([...findUnsafeIntegers(leftText), ...findUnsafeIntegers(rightText)]),
  ];
  return { ok: true, entries, identical: entries.length === 0, unsafeIntegers };
}

export function summarize(entries: DiffEntry[]): Record<DiffKind, number> {
  const summary: Record<DiffKind, number> = {
    added: 0,
    removed: 0,
    changed: 0,
    'type-changed': 0,
  };
  for (const entry of entries) summary[entry.kind]++;
  return summary;
}
