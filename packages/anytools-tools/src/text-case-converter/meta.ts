import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'text-case-converter',
  cluster: 'text-regex',
  title: {
    en: 'Text Case Converter',
    vi: 'Đổi Case Văn Bản',
    es: 'Conversor de mayúsculas y minúsculas',
    pt: 'Conversor de maiúsculas e minúsculas',
  },
  description: {
    en: 'Convert text between camelCase, snake_case, kebab-case, PascalCase, CONSTANT_CASE and 8 more. Browser-only.',
    vi: 'Chuyển văn bản giữa camelCase, snake_case, kebab-case, PascalCase, CONSTANT_CASE và 8 dạng khác. Chỉ trong browser.',
    es: 'Convierte texto entre camelCase, snake_case, kebab-case, PascalCase, CONSTANT_CASE y 8 formatos más. Solo en el navegador.',
    pt: 'Converte texto entre camelCase, snake_case, kebab-case, PascalCase, CONSTANT_CASE e mais 8 formatos. Só no navegador.',
  },
  keywords: [
    'case converter',
    'camelcase',
    'snake_case',
    'kebab-case',
    'pascalcase',
    'constant_case',
    'đổi case',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    { tool: 'slugify', reason: { en: 'Make text URL-safe', vi: 'Biến text thành URL-safe' } },
    {
      tool: 'regex-tester',
      reason: { en: 'Match converted patterns', vi: 'Match pattern đã đổi case' },
    },
  ],
};
