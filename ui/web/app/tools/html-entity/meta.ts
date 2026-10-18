import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'html-entity',
  cluster: 'encoding',
  title: {
    en: 'HTML Entity Encoder / Decoder',
    vi: 'Mã hóa / Giải mã HTML Entity',
    es: 'Codificador / decodificador de entidades HTML',
    pt: 'Codificador / decodificador de entidades HTML',
  },
  description: {
    en: 'Encode/decode HTML entities (&, <, >, named, numeric, hex). Full HTML5 entity set.',
    vi: 'Mã hóa/giải mã HTML entity (&, <, >, named, numeric, hex). Bộ HTML5 đầy đủ.',
    es: 'Codifica y decodifica entidades HTML (&, <, >, con nombre, numéricas, hex). Conjunto completo de entidades HTML5.',
    pt: 'Codifica e decodifica entidades HTML (&, <, >, nomeadas, numéricas, hex). Conjunto completo de entidades HTML5.',
  },
  keywords: ['html entity', 'html encode', 'html decode', '&', 'xss escape', 'html5 entities'],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'url-encode',
      reason: { en: 'Different encoding for URLs', vi: 'Encoding khác cho URL' },
    },
    {
      tool: 'base64-encode',
      reason: { en: 'For binary-safe transport', vi: 'Cho transport binary-safe' },
    },
  ],
};
