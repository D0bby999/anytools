import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'xml-formatter',
  cluster: 'formatters',
  title: {
    en: 'XML Formatter / Validator',
    vi: 'Định dạng / Kiểm tra XML',
    es: 'Formateador / validador de XML',
    pt: 'Formatador / validador de XML',
  },
  description: {
    en: 'Format, minify, and validate XML. Preserves attributes, namespaces, CDATA. Browser-only.',
    vi: 'Định dạng, minify, validate XML. Giữ attribute, namespace, CDATA. Chỉ trong browser.',
    es: 'Formatea, minifica y valida XML. Conserva atributos, namespaces y CDATA. Solo en el navegador.',
    pt: 'Formata, minifica e valida XML. Preserva atributos, namespaces e CDATA. Só no navegador.',
  },
  keywords: ['xml formatter', 'xml validator', 'xml beautifier', 'xml minify', 'pretty xml'],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'json-yaml-toml',
      reason: { en: 'Convert XML to JSON via parsing', vi: 'Convert XML sang JSON' },
    },
    { tool: 'json-formatter', reason: { en: 'Format the JSON output', vi: 'Format JSON output' } },
  ],
};
