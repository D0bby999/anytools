import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'json-diff',
  cluster: 'formatters',
  title: {
    en: 'JSON Diff',
    vi: 'So sánh JSON',
    es: 'Comparador de JSON',
    pt: 'Comparador de JSON',
  },
  description: {
    en: 'Structural JSON comparison — ignores key order and formatting, shows added/removed/changed values with exact paths. Smarter than a text diff. 100% local.',
    vi: 'So sánh JSON theo cấu trúc — bỏ qua thứ tự key và định dạng, chỉ ra giá trị thêm/xoá/đổi kèm đường dẫn chính xác. Thông minh hơn diff văn bản. 100% offline.',
    es: 'Comparación estructural de JSON — ignora orden de claves y formato, muestra valores añadidos/eliminados/cambiados con rutas exactas.',
    pt: 'Comparação estrutural de JSON — ignora ordem de chaves e formatação, mostra valores adicionados/removidos/alterados com caminhos exatos.',
  },
  keywords: [
    'json diff',
    'json compare',
    'compare json objects',
    'json difference',
    'diff json online',
    'so sánh json',
    'comparar json',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'json-formatter',
      reason: {
        en: 'Pretty-print either side before sharing',
        vi: 'Định dạng đẹp JSON trước khi chia sẻ',
        es: 'Formatea cualquiera de los lados antes de compartir',
        pt: 'Formate qualquer um dos lados antes de compartilhar',
      },
    },
    {
      tool: 'diff-checker',
      reason: {
        en: 'Need a line-by-line text diff instead?',
        vi: 'Cần diff văn bản theo dòng?',
        es: '¿Necesitas un diff de texto línea por línea?',
        pt: 'Precisa de um diff de texto linha a linha?',
      },
    },
  ],
};
