import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'mock-data-generator',
  cluster: 'generators',
  title: { en: 'Mock Data Generator', vi: 'Tạo Dữ Liệu Mock' },
  description: {
    en: 'Generate realistic mock data (users, emails, addresses, dates) as JSON, CSV, or SQL. 7 locales.',
    vi: 'Tạo dữ liệu mock thực tế (user, email, địa chỉ, ngày) ở dạng JSON, CSV, SQL. 7 locale.',
  },
  keywords: ['mock data', 'fake data', 'test data', 'fixture generator', 'faker', 'seed data'],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'json-formatter',
      reason: { en: 'Format the generated JSON', vi: 'Format JSON đã tạo' },
    },
    {
      tool: 'csv-json',
      reason: { en: 'Convert between CSV and JSON', vi: 'Chuyển giữa CSV và JSON' },
    },
  ],
};
