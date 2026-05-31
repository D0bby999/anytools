import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'csv-json',
  cluster: 'converters',
  title: { en: 'CSV ↔ JSON Converter', vi: 'Chuyển đổi CSV ↔ JSON' },
  description: {
    en: 'Convert between CSV and JSON. Auto-detect delimiter, quote handling, header row toggle. Browser-only.',
    vi: 'Chuyển đổi CSV và JSON. Tự nhận delimiter, xử lý quote, toggle header. Chỉ trong browser.',
  },
  keywords: ['csv to json', 'json to csv', 'csv parser', 'papaparse', 'tsv'],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    { tool: 'json-formatter', reason: { en: 'Format the JSON output', vi: 'Format JSON output' } },
    { tool: 'mock-data-generator', reason: { en: 'Generate test data', vi: 'Tạo dữ liệu test' } },
  ],
};
