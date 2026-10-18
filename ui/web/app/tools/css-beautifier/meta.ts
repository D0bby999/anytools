import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'css-beautifier',
  cluster: 'formatters',
  title: {
    en: 'CSS Beautifier',
    vi: 'Format CSS',
    es: 'Formateador CSS',
    pt: 'Formatador CSS',
  },
  description: {
    en: 'Pretty-print or minify CSS with configurable indent, selector separator, and brace style. 100% local.',
    vi: 'Format hoặc minify CSS với indent, dấu phân cách selector, brace style. 100% offline.',
    es: 'Formatea o minifica CSS con indentación, separador de selectores y estilo de llaves.',
    pt: 'Formate ou minifique CSS com indentação, separador de seletores e estilo de chaves.',
  },
  keywords: [
    'css beautifier',
    'css formatter',
    'css minify',
    'pretty css',
    'format css',
    'css pretty print',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'html-beautifier',
      reason: {
        en: 'Format HTML too',
        vi: 'Format HTML luôn',
        es: 'Formatear HTML también',
        pt: 'Formatar HTML também',
      },
    },
    {
      tool: 'js-beautifier',
      reason: {
        en: 'Format/minify JavaScript',
        vi: 'Format/minify JavaScript',
        es: 'Formatear/minificar JavaScript',
        pt: 'Formatar/minificar JavaScript',
      },
    },
  ],
};
