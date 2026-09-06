/**
 * Finds two text-hygiene problems that look identical to normal text but are not:
 *
 * 1. Invisible characters — zero-width joins, bidi controls, a BOM, a soft hyphen, or one of the
 *    dozen Unicode spaces that are not U+0020. These break search/diff and copy-paste silently.
 * 2. Homoglyphs — a Cyrillic or Greek letter substituted for a Latin one it is drawn identically
 *    to (Cyrillic а U+0430 for Latin a, Greek Ρ U+03A1 for Latin P, …). See homoglyph-table.ts
 *    for the pair list and the real bug (commit 9c8a1f1) that motivated this tool.
 *
 * Homoglyphs are flagged with a "mixed script" heuristic: a look-alike only counts when the
 * *rest* of the pasted text is a different script. A whole paragraph of real Russian or Greek
 * agrees with its own dominant script throughout, so nothing in it looks foreign; one stray
 * Cyrillic letter in an otherwise-Latin sentence disagrees with everything around it.
 */
import { HOMOGLYPHS, type Script } from './homoglyph-table';

type Invisible = { name: string; replacement: string };

/** Zero-width/bidi characters carry no width, so they are deleted outright. The odd spaces (NBSP,
 * U+2000..200A, ideographic/math spaces) DO carry width — deleted, "10 km" becomes "10km", which
 * trades one invisible bug for a visible one — so those normalize to a plain U+0020 instead. */
const INVISIBLE = new Map<number, Invisible>([
  [0x00ad, { name: 'Soft hyphen', replacement: '' }],
  [0x180e, { name: 'Mongolian vowel separator', replacement: '' }],
  [0x200b, { name: 'Zero-width space', replacement: '' }],
  [0x200c, { name: 'Zero-width non-joiner', replacement: '' }],
  [0x200d, { name: 'Zero-width joiner', replacement: '' }],
  [0x200e, { name: 'Left-to-right mark', replacement: '' }],
  [0x200f, { name: 'Right-to-left mark', replacement: '' }],
  [0x202a, { name: 'Left-to-right embedding', replacement: '' }],
  [0x202b, { name: 'Right-to-left embedding', replacement: '' }],
  [0x202c, { name: 'Pop directional formatting', replacement: '' }],
  [0x202d, { name: 'Left-to-right override', replacement: '' }],
  [0x202e, { name: 'Right-to-left override', replacement: '' }],
  [0x2060, { name: 'Word joiner', replacement: '' }],
  [0x2066, { name: 'Left-to-right isolate', replacement: '' }],
  [0x2067, { name: 'Right-to-left isolate', replacement: '' }],
  [0x2068, { name: 'First strong isolate', replacement: '' }],
  [0x2069, { name: 'Pop directional isolate', replacement: '' }],
  [0xfeff, { name: 'Byte order mark (zero-width no-break space)', replacement: '' }],
  [0x00a0, { name: 'No-break space', replacement: ' ' }],
  [0x205f, { name: 'Medium mathematical space', replacement: ' ' }],
  [0x3000, { name: 'Ideographic space', replacement: ' ' }],
]);
const SPACE_NAMES = [
  'En quad',
  'Em quad',
  'En space',
  'Em space',
  'Three-per-em space',
  'Four-per-em space',
  'Six-per-em space',
  'Figure space',
  'Punctuation space',
  'Thin space',
  'Hair space',
];
for (const [i, name] of SPACE_NAMES.entries())
  INVISIBLE.set(0x2000 + i, { name, replacement: ' ' });

/** Latin = ASCII + Latin-1 Supplement + Latin Extended A/B (<= U+024F) + Latin Extended
 * Additional (U+1E00..1EFF, where precomposed Vietnamese vowels live). */
function scriptOf(ch: string): Script | null {
  if (!/\p{L}/u.test(ch)) return null;
  const cp = ch.codePointAt(0) ?? 0;
  if (cp <= 0x24f || (cp >= 0x1e00 && cp <= 0x1eff)) return 'latin';
  if (cp >= 0x400 && cp <= 0x52f) return 'cyrillic';
  if ((cp >= 0x370 && cp <= 0x3ff) || (cp >= 0x1f00 && cp <= 0x1fff)) return 'greek';
  return null;
}

/** Majority script of the whole input, or `null` on no letters / an exact tie — either way,
 * nothing gets flagged as "foreign" without a clear majority to disagree with. */
function dominantScript(text: string): Script | null {
  let latin = 0;
  let cyrillic = 0;
  let greek = 0;
  for (const ch of text) {
    const s = scriptOf(ch);
    if (s === 'latin') latin++;
    else if (s === 'cyrillic') cyrillic++;
    else if (s === 'greek') greek++;
  }
  const max = Math.max(latin, cyrillic, greek);
  if (max === 0) return null;
  if ([latin, cyrillic, greek].filter((n) => n === max).length > 1) return null;
  if (latin === max) return 'latin';
  return cyrillic === max ? 'cyrillic' : 'greek';
}

export type UnicodeIssueKind = 'invisible' | 'homoglyph';

export type UnicodeIssue = {
  /** UTF-16 index into the original string — safe with String.slice/substring. */
  index: number;
  length: number;
  char: string;
  codePoint: number;
  name: string;
  kind: UnicodeIssueKind;
  /** What "clean" replaces this with: '' for most invisibles, ' ' for odd spaces, the plain
   * Latin letter for a homoglyph. */
  replacement: string;
  /** Homoglyphs only: the Latin letter this character impersonates. */
  looksLike?: string;
};

/** Scan for invisible characters (always) and homoglyphs (only where they disagree with the
 * text's own dominant script). Issues come back in left-to-right order. */
export function scanText(text: string): UnicodeIssue[] {
  const dominant = dominantScript(text);
  const issues: UnicodeIssue[] = [];
  let offset = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const invisible = INVISIBLE.get(cp);
    if (invisible) {
      issues.push({
        index: offset,
        length: ch.length,
        char: ch,
        codePoint: cp,
        name: invisible.name,
        kind: 'invisible',
        replacement: invisible.replacement,
      });
    } else {
      const homoglyph = HOMOGLYPHS.get(ch);
      if (homoglyph && dominant && dominant !== homoglyph.script) {
        issues.push({
          index: offset,
          length: ch.length,
          char: ch,
          codePoint: cp,
          name: homoglyph.name,
          kind: 'homoglyph',
          replacement: homoglyph.latin,
          looksLike: homoglyph.latin,
        });
      }
    }
    offset += ch.length;
  }
  return issues;
}

/** Apply every issue's `replacement`, left to right. Re-scans internally so a caller never
 * passes a stale issue list against text that has since changed. */
export function cleanText(text: string): { cleaned: string; issues: UnicodeIssue[] } {
  const issues = scanText(text);
  if (issues.length === 0) return { cleaned: text, issues };
  let cleaned = '';
  let cursor = 0;
  for (const issue of issues) {
    cleaned += text.slice(cursor, issue.index) + issue.replacement;
    cursor = issue.index + issue.length;
  }
  cleaned += text.slice(cursor);
  return { cleaned, issues };
}

export type TextSegment = { text: string; issue?: UnicodeIssue };

/** Split into plain/flagged runs so the UI can wrap just the flagged character in a `<mark>`. */
export function buildHighlightSegments(text: string, issues: UnicodeIssue[]): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const issue of issues) {
    if (issue.index > cursor) segments.push({ text: text.slice(cursor, issue.index) });
    segments.push({ text: text.slice(issue.index, issue.index + issue.length), issue });
    cursor = issue.index + issue.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

/** `U+0430` — the conventional way to display a codepoint next to its character. */
export function formatCodePoint(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}
