import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'regex-tester',
  cluster: 'text-regex',
  title: {
    en: 'Regex Tester',
    vi: 'Kiểm tra Regex',
    es: 'Probador de expresiones regulares',
    pt: 'Testador de expressões regulares',
  },
  description: {
    en: 'Test JavaScript regex patterns against any text. Capture groups, named groups, flags, replace mode. Browser-only.',
    vi: 'Test regex JavaScript trên text bất kỳ. Group capture, named group, flag, mode replace. Chỉ trong browser.',
    es: 'Prueba patrones regex de JavaScript sobre cualquier texto. Grupos de captura, grupos con nombre, flags y modo reemplazo. Solo en el navegador.',
    pt: 'Teste padrões regex de JavaScript em qualquer texto. Grupos de captura, grupos nomeados, flags e modo substituição. Só no navegador.',
  },
  keywords: ['regex', 'regex tester', 'regular expression', 'pattern matching', 'kiểm tra regex'],
  priority: 'P1',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'text-case-converter',
      reason: {
        en: 'Transform matched text into another case',
        vi: 'Biến text khớp sang case khác',
      },
    },
    {
      tool: 'json-formatter',
      reason: {
        en: 'Format matches when working with JSON strings',
        vi: 'Format match khi làm việc với chuỗi JSON',
      },
    },
  ],
};
