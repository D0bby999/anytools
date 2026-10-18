import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'yaml-formatter',
  cluster: 'formatters',
  title: {
    en: 'YAML Formatter / Validator',
    vi: 'Định dạng / Kiểm tra YAML',
    es: 'Formateador / validador de YAML',
    pt: 'Formatador / validador de YAML',
  },
  description: {
    en: 'Format, validate and optionally sort the keys of any YAML, with 2- or 4-space indent. Parse errors report the line that broke. Runs in your browser.',
    vi: 'Định dạng, validate và sắp xếp key của YAML bất kỳ, chọn indent 2 hoặc 4 space. Lỗi cú pháp báo rõ dòng sai. Chạy ngay trong browser.',
    es: 'Formatea, valida y opcionalmente ordena las claves de cualquier YAML, con sangría de 2 o 4 espacios. Los errores indican la línea que falló. Se ejecuta en tu navegador.',
    pt: 'Formata, valida e opcionalmente ordena as chaves de qualquer YAML, com recuo de 2 ou 4 espaços. Erros de sintaxe apontam a linha que falhou. Roda no seu navegador.',
  },
  keywords: ['yaml formatter', 'yaml validator', 'yaml pretty', 'yaml lint', 'k8s yaml'],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'json-yaml-toml',
      reason: { en: 'Convert YAML to JSON or TOML', vi: 'Convert YAML sang JSON hoặc TOML' },
    },
    { tool: 'json-formatter', reason: { en: 'Format the JSON output', vi: 'Format JSON output' } },
  ],
};
