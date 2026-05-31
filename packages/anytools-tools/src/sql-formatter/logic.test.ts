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
  it('tightens around commas and parens', () => {
    expect(minifySql('SELECT a , b FROM t')).toBe('SELECT a,b FROM t');
    expect(minifySql('COUNT( * )')).toBe('COUNT(*)');
  });
});
