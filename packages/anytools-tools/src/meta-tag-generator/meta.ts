import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'meta-tag-generator',
  cluster: 'generators',
  // Widget strings are localized (strings.ts). Where no vi/es/pt FAQ body exists yet the
  // page serves noindex and stays out of the sitemap (has-localized-tool-body.ts).
  title: {
    en: 'Meta Tag Generator',
    vi: 'Tạo Thẻ Meta',
    es: 'Generador de Meta Tags',
    pt: 'Gerador de Meta Tags',
  },
  // English only — these ship with availableLocales:['en'], and a copy of the English
  // string in a vi/es/pt slot is not a translation, it is a lie the fallback already tells better.
  description: {
    en: 'Generate title, description, Open Graph and Twitter card tags, with warnings for the mistakes that break social previews.',
  },
  keywords: [
    'meta tag generator',
    'open graph generator',
    'og tags generator',
    'twitter card generator',
    'seo meta tags',
    'html meta tag',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'slugify',
      reason: { en: 'Make a URL slug for the page' },
    },
    {
      tool: 'qr-code-generator',
      reason: { en: 'Make a QR code for the URL' },
    },
  ],
};
