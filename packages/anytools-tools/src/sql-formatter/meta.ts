import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'sql-formatter',
  cluster: 'formatters',
  title: { en: 'SQL Formatter', vi: 'Định dạng SQL' },
  description: {
    en: 'Format SQL across 10 dialects (Postgres, MySQL, SQLite, BigQuery, Snowflake, T-SQL, PL/SQL, …). Browser-only.',
    vi: 'Định dạng SQL cho 10 dialect (Postgres, MySQL, SQLite, BigQuery, Snowflake, T-SQL, PL/SQL, …). Chỉ trong browser.',
  },
  keywords: [
    'sql formatter',
    'sql beautify',
    'postgres formatter',
    'mysql formatter',
    'sql pretty',
    'định dạng sql',
  ],
  priority: 'P1',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'json-formatter',
      reason: { en: 'Format JSON output from your queries', vi: 'Định dạng JSON output từ query' },
    },
    {
      tool: 'regex-tester',
      reason: {
        en: 'Build regex patterns for SQL LIKE/SIMILAR TO',
        vi: 'Build regex cho SQL LIKE/SIMILAR TO',
      },
    },
  ],
};
