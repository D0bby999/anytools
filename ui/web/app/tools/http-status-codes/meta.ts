import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'http-status-codes',
  cluster: 'encoding',
  title: {
    en: 'HTTP Status Codes & MIME Types',
    vi: 'Mã trạng thái HTTP & MIME Types',
    es: 'Códigos de Estado HTTP y Tipos MIME',
    pt: 'Códigos de Status HTTP e Tipos MIME',
  },
  description: {
    en: 'Searchable reference for every common HTTP status code (what it really means) plus file-extension → MIME type lookup. Instant filter, works offline.',
    vi: 'Tra cứu nhanh mọi mã trạng thái HTTP phổ biến (ý nghĩa thật sự) kèm bảng đuôi file → MIME type. Lọc tức thì, chạy offline.',
    es: 'Referencia con búsqueda de códigos de estado HTTP (qué significan realmente) más búsqueda de extensión → tipo MIME.',
    pt: 'Referência pesquisável de códigos de status HTTP (o que realmente significam) mais busca de extensão → tipo MIME.',
  },
  keywords: [
    'http status codes',
    '404 meaning',
    '502 vs 504',
    'status code list',
    'mime types',
    'content type list',
    'mã trạng thái http',
    'códigos http',
  ],
  priority: 'P3',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'curl-converter',
      reason: {
        en: 'Turn a failing request into runnable code',
        vi: 'Chuyển request lỗi thành code chạy được',
        es: 'Convierte una petición fallida en código ejecutable',
        pt: 'Transforme uma requisição com erro em código executável',
      },
    },
    {
      tool: 'jwt-decoder',
      reason: {
        en: 'Got a 401? Inspect the token',
        vi: 'Bị 401? Soi token của bạn',
        es: '¿Un 401? Inspecciona el token',
        pt: 'Recebeu 401? Inspecione o token',
      },
    },
  ],
};
