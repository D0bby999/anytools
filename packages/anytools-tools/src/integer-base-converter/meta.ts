import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'integer-base-converter',
  cluster: 'encoding',
  availableLocales: ['en'],
  title: {
    en: 'Integer Base Converter',
    vi: 'Chuyển Đổi Cơ Số',
    es: 'Conversor de Base',
    pt: 'Conversor de Base',
  },
  // English only — these ship with availableLocales:['en'], and a copy of the English
  // string in a vi/es/pt slot is not a translation, it is a lie the fallback already tells better.
  description: {
    en: 'Convert whole numbers between binary, octal, decimal, hex and any base from 2 to 36. Exact for values above 2^53, where parseInt quietly rounds.',
  },
  keywords: [
    'integer base converter',
    'binary to decimal',
    'decimal to hex',
    'base 36 converter',
    'number base converter',
    'hex to binary',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'binary-encode',
      reason: { en: 'Encode text as binary, not numbers' },
    },
    {
      tool: 'hex-encode',
      reason: { en: 'Encode text as hexadecimal' },
    },
  ],
};
