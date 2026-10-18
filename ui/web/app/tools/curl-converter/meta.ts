import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'curl-converter',
  cluster: 'converters',
  title: {
    en: 'curl → Code Converter',
    vi: 'Chuyển curl sang Code',
    es: 'Conversor de curl a código',
    pt: 'Conversor de curl para código',
  },
  description: {
    en: 'Convert curl commands to fetch, axios, Node, Python, PHP, Go. Browser-only.',
    vi: 'Chuyển curl sang fetch, axios, Node, Python, PHP, Go. Chỉ trong browser.',
    es: 'Convierte comandos curl a fetch, axios, Node, Python, PHP y Go. Solo en el navegador.',
    pt: 'Converte comandos curl para fetch, axios, Node, Python, PHP e Go. Só no navegador.',
  },
  keywords: [
    'curl to fetch',
    'curl to python',
    'curl to javascript',
    'curl converter',
    'curl to code',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'jwt-decoder',
      reason: {
        en: 'Decode JWTs in your Authorization headers',
        vi: 'Decode JWT trong header Authorization',
      },
    },
    {
      tool: 'json-formatter',
      reason: { en: 'Format JSON request/response bodies', vi: 'Format JSON body' },
    },
  ],
};
