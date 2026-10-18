import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'uuid-generator',
  cluster: 'generators',
  title: {
    en: 'UUID Generator',
    vi: 'Tạo UUID',
    es: 'Generador de UUID',
    pt: 'Gerador de UUID',
  },
  description: {
    en: 'Generate UUIDs v4, v7, and v1 in the browser. Sortable v7 recommended for database keys.',
    vi: 'Tạo UUID v4, v7, v1 trong trình duyệt. v7 sortable khuyến nghị cho database key.',
    es: 'Genera UUID v4, v7 y v1 en el navegador. El v7 ordenable es el recomendado para claves de base de datos.',
    pt: 'Gera UUID v4, v7 e v1 no navegador. O v7 ordenável é o recomendado para chaves de banco de dados.',
  },
  keywords: ['uuid', 'uuid v4', 'uuid v7', 'uuid v1', 'guid', 'uuid generator', 'tạo uuid'],
  priority: 'P1',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'hash-generator',
      reason: { en: 'Hash a UUID to get a shorter ID', vi: 'Hash UUID để có ID ngắn hơn' },
    },
    {
      tool: 'password-generator',
      reason: { en: 'Generate cryptographic random strings', vi: 'Tạo chuỗi random mã hóa' },
    },
  ],
};
