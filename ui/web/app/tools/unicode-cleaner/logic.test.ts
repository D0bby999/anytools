import { describe, expect, it } from 'vitest';
import { buildHighlightSegments, cleanText, formatCodePoint, scanText } from './logic';

// Cyrillic je (U+0458), Cyrillic a (U+0430), BOM, ZWSP and NBSP below are written as \u escapes,
// never as literal glyphs, on purpose: this is a homoglyph/invisible-character test fixture, and
// pasting the actual look-alike or invisible bytes into a source file is exactly the kind of
// silent corruption this tool exists to catch.
const CYRILLIC_JE = '\u0458';
const CYRILLIC_A = '\u0430';
const BOM = '\uFEFF';
const ZWSP = '\u200B';
const NBSP = '\u00A0';

describe('scanText - real bug from commit 9c8a1f1', () => {
  it('flags the Cyrillic je/a pair hiding in "redibuja" inside a Spanish sentence', () => {
    // Same shape as the actual FAQ line before the fix: mostly-Latin Spanish prose with two
    // Cyrillic look-alikes standing in for Latin j and a.
    const text = `Cada imagen se decodifica y se redibu${CYRILLIC_JE}${CYRILLIC_A} por JavaScript en esta pestana del navegador.`;
    const issues = scanText(text).filter((i) => i.kind === 'homoglyph');
    expect(issues.map((i) => i.codePoint).sort()).toEqual([0x0430, 0x0458]);
    for (const issue of issues) {
      expect(issue.char).toBe(text[issue.index]);
    }
  });

  it('clean() rewrites the sentence back to plain Latin "redibuja"', () => {
    const text = `se redibu${CYRILLIC_JE}${CYRILLIC_A} por JavaScript en esta pestana del navegador.`;
    const { cleaned } = cleanText(text);
    expect(cleaned).toContain('redibuja');
    expect(cleaned).not.toContain(CYRILLIC_JE);
    expect(cleaned).not.toContain(CYRILLIC_A);
  });
});

describe('scanText - script-mixed heuristic avoids false positives', () => {
  it('does not flag a real Russian paragraph', () => {
    const text = 'Добро пожаловать! Это настоящий русский текст без ошибок.';
    expect(scanText(text).filter((i) => i.kind === 'homoglyph')).toHaveLength(0);
  });

  it('does not flag a real Greek paragraph', () => {
    const text = 'Καλημέρα! Αυτό είναι πραγματικό ελληνικό κείμενο.';
    expect(scanText(text).filter((i) => i.kind === 'homoglyph')).toHaveLength(0);
  });

  it('does not flag Vietnamese diacritics', () => {
    const text = 'Xin chào, đây là tiếng Việt có dấu, không có ký tự ẩn nào cả.';
    expect(scanText(text)).toHaveLength(0);
  });

  it('flags a lone Cyrillic letter dropped into an otherwise-Latin sentence', () => {
    // Latin "a" replaced by Cyrillic a (U+0430) in an English sentence -- classic phishing shape.
    const text = `Please sign in at ${CYRILLIC_A}pple.com to continue.`;
    const issues = scanText(text).filter((i) => i.kind === 'homoglyph');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.codePoint).toBe(0x0430);
    expect(issues[0]?.looksLike).toBe('a');
  });
});

describe('scanText - invisible characters', () => {
  it('detects BOM, ZWSP and NBSP', () => {
    const text = `${BOM}Hello${ZWSP}world${NBSP}there`;
    const issues = scanText(text).filter((i) => i.kind === 'invisible');
    expect(issues.map((i) => i.codePoint)).toEqual([0xfeff, 0x200b, 0x00a0]);
  });

  it('cleans BOM and ZWSP to nothing, NBSP to a plain space', () => {
    const text = `${BOM}Hello${ZWSP}world${NBSP}there`;
    const { cleaned } = cleanText(text);
    expect(cleaned).toBe('Helloworld there');
  });

  it('leaves clean ASCII text untouched', () => {
    const text = 'Nothing hidden here.';
    expect(scanText(text)).toHaveLength(0);
    expect(cleanText(text).cleaned).toBe(text);
  });
});

describe('buildHighlightSegments', () => {
  it('splits text into plain and flagged runs around each issue', () => {
    const text = `a${ZWSP}b`;
    const issues = scanText(text);
    const segments = buildHighlightSegments(text, issues);
    expect(segments).toEqual([{ text: 'a' }, { text: ZWSP, issue: issues[0] }, { text: 'b' }]);
  });

  it('returns the whole string as one plain segment when there are no issues', () => {
    const segments = buildHighlightSegments('plain', []);
    expect(segments).toEqual([{ text: 'plain' }]);
  });
});

describe('formatCodePoint', () => {
  it('formats as U+XXXX, zero-padded and uppercase', () => {
    expect(formatCodePoint(0x0430)).toBe('U+0430');
    expect(formatCodePoint(0xa)).toBe('U+000A');
  });
});
