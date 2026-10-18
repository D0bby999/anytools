import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'html-beautifier',
  cluster: 'formatters',
  title: {
    en: 'HTML Beautifier',
    vi: 'Format HTML',
    es: 'Formateador HTML',
    pt: 'Formatador HTML',
  },
  description: {
    en: 'Pretty-print or minify HTML with configurable indent, attribute wrapping, and self-closing handling. 100% local.',
    vi: 'Format hoặc minify HTML với indent, ngắt thuộc tính, self-closing tùy chỉnh. 100% offline.',
    es: 'Formatea o minifica HTML con indentación, ajuste de atributos y manejo self-closing configurables.',
    pt: 'Formate ou minifique HTML com indentação, quebra de atributos e self-closing configuráveis.',
  },
  keywords: [
    'html beautifier',
    'html formatter',
    'html minify',
    'pretty html',
    'html pretty print',
    'format html',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'css-beautifier',
      reason: {
        en: 'Format CSS too',
        vi: 'Format CSS luôn',
        es: 'Formatear CSS también',
        pt: 'Formatar CSS também',
      },
    },
    {
      tool: 'md-html',
      reason: {
        en: 'Convert Markdown to HTML',
        vi: 'Convert Markdown sang HTML',
        es: 'Convertir Markdown a HTML',
        pt: 'Converter Markdown para HTML',
      },
    },
  ],
};
