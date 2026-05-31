import { type SqlLanguage, format as sqlFormat } from 'sql-formatter';

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

export function minifySql(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\s*([,()])\s*/g, '$1')
    .trim();
}
