import { describe, expect, it } from 'vitest';
import { formatSql, minifySql } from './logic';

const baseOpts = { language: 'sql' as const, tabWidth: 2, keywordCase: 'upper' as const };

describe('formatSql', () => {
  it('uppercases keywords + indents', () => {
    const out = formatSql('select * from users where id = 1', baseOpts);
    expect(out).toContain('SELECT');
    expect(out).toContain('FROM');
    expect(out).toContain('WHERE');
  });

  it('preserves case when requested', () => {
    const out = formatSql('select 1', { ...baseOpts, keywordCase: 'preserve' });
    expect(out).toContain('select');
  });

  it('handles PostgreSQL ::cast', () => {
    const out = formatSql("SELECT '1'::int FROM users", { ...baseOpts, language: 'postgresql' });
    expect(out).toContain('::');
  });

  it('handles MySQL backtick identifiers', () => {
    const out = formatSql('SELECT `name` FROM `users`', { ...baseOpts, language: 'mysql' });
    expect(out).toContain('`name`');
  });
});

describe('minifySql', () => {
  it('collapses whitespace', () => {
    expect(minifySql('SELECT  *\n  FROM  users')).toBe('SELECT * FROM users');
  });
  // Review 2026-09-05: "SELECT 1 -- note FROM t" commented out the rest of the query.
  it('removes comments instead of folding the query into them', () => {
    expect(minifySql('SELECT 1 -- pick one\nFROM t')).toBe('SELECT 1 FROM t');
    expect(minifySql('SELECT /* a */ 1\nFROM t')).toBe('SELECT 1 FROM t');
  });
  it('leaves string literals and quoted identifiers alone', () => {
    expect(minifySql("SELECT 'a, b' FROM t WHERE x IN (1, 2)")).toBe(
      "SELECT 'a, b' FROM t WHERE x IN(1,2)",
    );
    expect(minifySql('SELECT "my  col", `a , b` FROM t')).toBe('SELECT "my  col",`a , b` FROM t');
    expect(minifySql("SELECT 'it''s -- not a comment' FROM t")).toBe(
      "SELECT 'it''s -- not a comment' FROM t",
    );
  });
  it('tightens around commas and parens', () => {
    expect(minifySql('SELECT a , b FROM t')).toBe('SELECT a,b FROM t');
    expect(minifySql('COUNT( * )')).toBe('COUNT(*)');
  });
});
