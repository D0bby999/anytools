import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'unicode-escape',
  cluster: 'encoding',
  title: {
    en: 'Unicode Escape / Unescape',
    vi: 'Escape / Unescape Unicode',
    es: 'Escape / Unescape Unicode',
    pt: 'Escape / Unescape Unicode',
  },
  description: {
    en: 'Convert text to \\uXXXX or \\u{XXXXX} escapes and back. Handles surrogate pairs for emoji. Output JSON-safe or ES2015 syntax.',
    vi: 'Convert text sang \\uXXXX hoặc \\u{XXXXX} escape và ngược lại. Hỗ trợ surrogate pair cho emoji. Output JSON-safe hoặc ES2015.',
    es: 'Convierte texto a escapes \\uXXXX o \\u{XXXXX} y viceversa. Maneja pares surrogate para emoji.',
    pt: 'Converta texto para escapes \\uXXXX ou \\u{XXXXX} e vice-versa. Lida com pares surrogate para emoji.',
  },
  keywords: [
    'unicode escape',
    'unicode unescape',
    'utf-16',
    'uXXXX',
    'surrogate pair',
    'json escape unicode',
    'js unicode',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'html-entity',
      reason: {
        en: 'HTML entities use similar escaping',
        vi: 'HTML entity dùng escape tương tự',
        es: 'Entidades HTML escapan parecido',
        pt: 'Entidades HTML escapam parecido',
      },
    },
    {
      tool: 'url-encode',
      reason: {
        en: 'URL encoding for query strings',
        vi: 'URL encode cho query string',
        es: 'URL encoding para query strings',
        pt: 'URL encoding para query strings',
      },
    },
  ],
};
