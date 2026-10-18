import { type Change, createPatch, diffChars, diffLines, diffWords } from 'diff';

export type Granularity = 'char' | 'word' | 'line';

export function diffText(a: string, b: string, granularity: Granularity): Change[] {
  if (granularity === 'char') return diffChars(a, b);
  if (granularity === 'word') return diffWords(a, b);
  return diffLines(a, b);
}

export function generatePatch(a: string, b: string, filename = 'file'): string {
  return createPatch(filename, a, b, '', '');
}

export type DiffStats = { added: number; removed: number; unchanged: number };

export function diffStats(changes: Change[]): DiffStats {
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const c of changes) {
    const len = c.value.length;
    if (c.added) added += len;
    else if (c.removed) removed += len;
    else unchanged += len;
  }
  return { added, removed, unchanged };
}
