import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'user-agent-parser',
  cluster: 'text-regex',
  // Widget strings are localized (strings.ts). Where no vi/es/pt FAQ body exists yet the
  // page serves noindex and stays out of the sitemap (has-localized-tool-body.ts).
  title: {
    en: 'User Agent Parser',
    vi: 'Phân Tích User Agent',
    es: 'Analizador de User Agent',
    pt: 'Analisador de User Agent',
  },
  // English only — these ship with availableLocales:['en'], and a copy of the English
  // string in a vi/es/pt slot is not a translation, it is a lie the fallback already tells better.
  description: {
    en: 'Read a User-Agent string into browser, engine, OS and device. Handles the fact that Edge claims to be Chrome and Chrome claims to be Safari.',
  },
  keywords: [
    'user agent parser',
    'parse user agent',
    'user agent analyzer',
    'detect browser from user agent',
    'ua string parser',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'url-parser',
      reason: { en: 'Break apart a URL instead' },
    },
    {
      tool: 'http-status-codes',
      reason: { en: 'Look up an HTTP status or MIME type' },
    },
  ],
};
