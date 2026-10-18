import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'slugify',
  cluster: 'text-regex',
  title: {
    en: 'Slugify',
    vi: 'Tạo Slug',
    es: 'Generador de slugs',
    pt: 'Gerador de slugs',
  },
  description: {
    en: 'Turn any text into URL-safe slug. Handles Vietnamese diacritics, German ß, French accents, emoji.',
    vi: 'Biến văn bản bất kỳ thành slug URL-safe. Xử lý dấu tiếng Việt, ß tiếng Đức, dấu tiếng Pháp, emoji.',
    es: 'Convierte cualquier texto en un slug seguro para URL. Gestiona acentos del vietnamita, la ß alemana, acentos franceses y emoji.',
    pt: 'Transforma qualquer texto em um slug seguro para URL. Trata acentos do vietnamita, o ß alemão, acentos franceses e emoji.',
  },
  keywords: ['slugify', 'slug generator', 'url slug', 'seo slug', 'transliterate', 'tạo slug'],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'text-case-converter',
      reason: { en: 'Change case before slugifying', vi: 'Đổi case trước khi slugify' },
    },
    {
      tool: 'url-encode',
      reason: { en: 'Encode the slug for URL parameters', vi: 'Encode slug cho URL parameter' },
    },
  ],
};
