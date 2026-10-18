import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'js-beautifier',
  cluster: 'formatters',
  title: {
    en: 'JavaScript Beautifier & Minifier',
    vi: 'Format & Minify JavaScript',
    es: 'Formateador y Minificador JavaScript',
    pt: 'Formatador e Minificador JavaScript',
  },
  description: {
    en: 'Pretty-print or minify JavaScript with real AST. Beautify via js-beautify, minify via Terser. ES2024 syntax supported.',
    vi: 'Format hoặc minify JavaScript với AST thật. Beautify dùng js-beautify, minify dùng Terser. Hỗ trợ ES2024.',
    es: 'Formatea o minifica JavaScript con AST real. Beautify vía js-beautify, minify vía Terser.',
    pt: 'Formate ou minifique JavaScript com AST real. Beautify via js-beautify, minify via Terser.',
  },
  keywords: [
    'js beautifier',
    'js minifier',
    'javascript formatter',
    'javascript minify',
    'terser',
    'js-beautify',
    'pretty js',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'json-formatter',
      reason: {
        en: 'Format JSON values inside your JS',
        vi: 'Format JSON trong JS',
        es: 'Formatear JSON en tu JS',
        pt: 'Formatar JSON no seu JS',
      },
    },
    {
      tool: 'html-beautifier',
      reason: {
        en: 'Format HTML too',
        vi: 'Format HTML luôn',
        es: 'Formatear HTML también',
        pt: 'Formatar HTML também',
      },
    },
  ],
};
