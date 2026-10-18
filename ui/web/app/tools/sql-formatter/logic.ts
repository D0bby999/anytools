import { type SqlLanguage, format as sqlFormat } from 'sql-formatter';
import { protectSegments } from '../shared/protect-segments';

export type SqlDialect = SqlLanguage;

export const DIALECTS: { value: SqlDialect; label: string }[] = [
  { value: 'sql', label: 'Standard SQL' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'mariadb', label: 'MariaDB' },
  { value: 'bigquery', label: 'BigQuery' },
  { value: 'snowflake', label: 'Snowflake' },
  { value: 'redshift', label: 'Redshift' },
  { value: 'tsql', label: 'T-SQL (SQL Server)' },
  { value: 'plsql', label: 'PL/SQL (Oracle)' },
];

export type FormatOptions = {
  language: SqlDialect;
  tabWidth: number;
  keywordCase: 'upper' | 'lower' | 'preserve';
};

export function formatSql(sql: string, options: FormatOptions): string {
  return sqlFormat(sql, {
    language: options.language,
    tabWidth: options.tabWidth,
    keywordCase: options.keywordCase,
  });
}

// Quoted strings and quoted identifiers keep their spaces: 'a, b' is data.
const SQL_LITERALS = /'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`/g;

/**
 * Comments go first, and go entirely: collapsing whitespace before stripping them turned
 * `SELECT 1 -- note\nFROM t` into `SELECT 1 -- note FROM t`, which comments out the rest
 * of the query.
 */
export function minifySql(sql: string): string {
  const { text, restore } = protectSegments(sql, SQL_LITERALS);
  const minified = text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,()])\s*/g, '$1')
    .trim();
  return restore(minified);
}
