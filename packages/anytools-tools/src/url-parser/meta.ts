import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'url-parser',
  cluster: 'text-regex',
  availableLocales: ['en'],
  title: {
    en: 'URL Parser',
    vi: 'Phân Tích URL',
    es: 'Analizador de URL',
    pt: 'Analisador de URL',
  },
  // English only — these ship with availableLocales:['en'], and a copy of the English
  // string in a vi/es/pt slot is not a translation, it is a lie the fallback already tells better.
  description: {
    en: 'Break a URL into protocol, host, port, path segments and query parameters. Repeated query keys are kept, not collapsed.',
  },
  keywords: [
    'url parser',
    'parse url online',
    'url components',
    'query string parser',
    'url analyzer',
    'split url parts',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'url-encode',
      reason: { en: 'Percent-encode or decode a component' },
    },
    {
      tool: 'slugify',
      reason: { en: 'Turn a title into a URL slug' },
    },
  ],
};
