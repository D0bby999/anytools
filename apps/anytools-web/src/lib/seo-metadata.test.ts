import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POPULATED_CLUSTERS } from './cluster-config';
import {
  MAX_DESCRIPTION_CHARS,
  MAX_TITLE_CHARS,
  buildToolTitle,
  clampMetaDescription,
  fitTitle,
} from './seo-metadata';

describe('buildToolTitle', () => {
  it('keeps the full template when it fits', () => {
    expect(buildToolTitle('JSON Formatter', 'Formatter')).toBe(
      'JSON Formatter — Free Online Formatter | AnyTools',
    );
  });

  // The three pages that were over 70 chars on prod, 2026-08-31.
  it.each([
    ['Hash Generator (MD5, SHA-1/256/384/512)', 'Generator'],
    ['Color Converter & Contrast Checker', 'Design Tool'],
    ['Statistics Calculator — Mean, Median, Std Dev', 'Tool'],
  ])('brings %s under the limit', (title, category) => {
    const out = buildToolTitle(title, category);
    expect(out.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
    // The tool name is the part that carries the keywords — never truncate it.
    expect(out.startsWith(title)).toBe(true);
  });

  it('tries dropping the brand before dropping the category', () => {
    // 'Timestamp Converter (Unix ⇄ Date)' + ' — Free Online Date Tool' = 57, fits
    // once '| AnyTools' goes; the category keyword is worth more than the brand.
    const out = buildToolTitle('Timestamp Converter (Unix ⇄ Date)', 'Date Tool');
    expect(out).toBe('Timestamp Converter (Unix ⇄ Date) — Free Online Date Tool');
  });

  it('keeps the brand instead when the category phrase is what overflows', () => {
    // Title is long enough that '— Free Online Tool' (18) overflows but '| AnyTools' (11) fits.
    const out = buildToolTitle('Statistics Calculator — Mean, Median, Std Dev', 'Tool');
    expect(out).toBe('Statistics Calculator — Mean, Median, Std Dev | AnyTools');
    expect(out.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
  });

  it('returns the bare title when nothing else fits', () => {
    const long = 'A'.repeat(80);
    expect(buildToolTitle(long, 'Tool')).toBe(long);
  });

  // Prod 2026-09-05: /vi/encoding/base64-encode rendered
  // "Mã hóa & Giải mã Base64 — Free Online Encoder | AnyTools" — the tool name
  // in Vietnamese, the keyword phrase in English.
  it.each([
    ['vi', 'Công cụ mã hóa', 'Mã hóa & Giải mã Base64 — Công cụ mã hóa online miễn phí'],
    ['es', 'Codificador', 'Mã hóa & Giải mã Base64 — Codificador online gratis'],
    ['pt', 'Codificador', 'Mã hóa & Giải mã Base64 — Codificador online grátis'],
  ])('writes the category phrase in the page language (%s)', (locale, category, expected) => {
    const out = buildToolTitle('Mã hóa & Giải mã Base64', category, locale);
    expect(out).toBe(expected);
    expect(out).not.toContain('Free Online');
    expect(out.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
  });

  it('falls back to the English phrase for an unknown locale', () => {
    expect(buildToolTitle('JSON Formatter', 'Formatter', 'de')).toBe(
      'JSON Formatter — Free Online Formatter | AnyTools',
    );
  });
});

describe('fitTitle', () => {
  it('appends the suffix when the result fits', () => {
    expect(fitTitle('Unit Converter', ' | AnyTools Guides')).toBe(
      'Unit Converter | AnyTools Guides',
    );
  });

  it('drops the suffix rather than let it be truncated away', () => {
    const long = 'Free Finance Calculators — Mortgage, Loan, Tip, Compound Interest';
    const out = fitTitle(long, ' | AnyTools Guides');
    expect(out).toBe(long);
    expect(out.length).toBeLessThanOrEqual(MAX_TITLE_CHARS + 5);
  });
});

describe('clampMetaDescription', () => {
  it('leaves a description that already fits untouched', () => {
    const short = 'Wallet address checker (ENS, format, checksum), ETH to Wei converter.';
    expect(clampMetaDescription(short)).toBe(short);
  });

  it('collapses stray whitespace', () => {
    expect(clampMetaDescription('a\n  b   c')).toBe('a b c');
  });

  it('cuts at a sentence boundary rather than mid-clause', () => {
    const finance =
      'Mortgage, loan, tip, percentage, compound interest built so you can answer how much in seconds. ' +
      'No signup, results stay local. For estimation only - verify with a licensed advisor.';
    const out = clampMetaDescription(finance);
    expect(out.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
    expect(out.endsWith('.')).toBe(true);
    // Must not strand the caveat half-said.
    expect(out).not.toContain('verify with a licensed');
  });

  it('falls back to a word boundary when there is no usable sentence break', () => {
    const out = clampMetaDescription(`${'word '.repeat(60)}end`);
    expect(out.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS + 1);
    expect(out.endsWith('\u2026')).toBe(true);
    expect(out).not.toMatch(/ \u2026$/);
  });

  it('never emits a dangling separator before the ellipsis', () => {
    const out = clampMetaDescription(`${'alpha beta,'.repeat(30)}`);
    expect(out).not.toMatch(/[,;:\u2014-]\u2026$/);
  });
});

describe('real cluster intros stay within the SERP limit', () => {
  // Guards the content, not just the function: an intro edited to 300 characters with
  // no sentence break would silently ship an over-length description.
  it.each(['en', 'vi', 'es', 'pt'])('%s', (locale) => {
    const messages = JSON.parse(
      fs.readFileSync(
        `${process.cwd()}/../../packages/anytools-i18n/src/messages/${locale}/common.json`,
        'utf8',
      ),
    );
    const tooLong: string[] = [];
    // Only clusters that actually ship a page — the empty ones are 404 and their
    // leftover copy is not user-facing.
    for (const cluster of POPULATED_CLUSTERS) {
      const value = messages.clusterLanding[cluster] as { intro?: string } | undefined;
      if (!value?.intro) continue;
      const out = clampMetaDescription(value.intro);
      if (out.length > MAX_DESCRIPTION_CHARS) tooLong.push(`${cluster}: ${out.length}`);
      expect(out.length, `${cluster} must not be a stub`).toBeGreaterThanOrEqual(70);
    }
    expect(tooLong).toEqual([]);
  });
});
