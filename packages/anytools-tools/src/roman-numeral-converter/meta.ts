import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'roman-numeral-converter',
  cluster: 'converters',
  availableLocales: ['en'],
  title: {
    en: 'Roman Numeral Converter',
    vi: 'Chuyển Số La Mã',
    es: 'Conversor de Números Romanos',
    pt: 'Conversor de Numerais Romanos',
  },
  // English only — these ship with availableLocales:['en'], and a copy of the English
  // string in a vi/es/pt slot is not a translation, it is a lie the fallback already tells better.
  description: {
    en: 'Convert between Roman numerals and numbers, both directions. Rejects readable-but-invalid forms like IIII and IM.',
  },
  keywords: [
    'roman numeral converter',
    'roman numerals to numbers',
    'number to roman numeral',
    'convert roman numerals',
    'roman numeral translator',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'integer-base-converter',
      reason: { en: 'Convert between number bases' },
    },
    {
      tool: 'unit-converter',
      reason: { en: 'Convert units of measure' },
    },
  ],
};
