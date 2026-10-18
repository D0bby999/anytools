import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'readability-analyzer',
  cluster: 'lifestyle',
  title: {
    en: 'Readability Analyzer (Flesch-Kincaid)',
    vi: 'Phân tích độ dễ đọc (Flesch-Kincaid)',
    es: 'Analizador de legibilidad (Flesch-Kincaid)',
    pt: 'Analisador de legibilidade (Flesch-Kincaid)',
  },
  description: {
    en: 'Flesch Reading Ease + Flesch-Kincaid Grade Level + Gunning Fog. English text only.',
    vi: 'Flesch Reading Ease + Flesch-Kincaid Grade Level + Gunning Fog. Chỉ áp dụng cho văn bản tiếng Anh.',
    es: 'Flesch Reading Ease + nivel Flesch-Kincaid + Gunning Fog. Solo para texto en inglés.',
    pt: 'Flesch Reading Ease + nível Flesch-Kincaid + Gunning Fog. Apenas para texto em inglês.',
  },
  keywords: [
    'readability analyzer',
    'flesch kincaid',
    'reading level',
    'gunning fog',
    'grade level',
  ],
  priority: 'P3',
  effort: 'S',
  published: true,
  availableLocales: ['en'],
};
