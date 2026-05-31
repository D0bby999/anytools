import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'readability-analyzer',
  cluster: 'lifestyle',
  title: {
    en: 'Readability Analyzer (Flesch-Kincaid)',
  },
  description: {
    en: 'Flesch Reading Ease + Flesch-Kincaid Grade Level + Gunning Fog. English text only.',
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
