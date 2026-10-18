import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'remove-pdf-pages',
  cluster: 'pdf',
  // Widget strings are localized (strings.ts). Where no vi/es/pt FAQ body exists yet the
  // page serves noindex and stays out of the sitemap (has-localized-tool-body.ts).
  title: {
    en: 'Remove PDF Pages',
    vi: 'Xoá Trang PDF',
    es: 'Eliminar Páginas de PDF',
    pt: 'Remover Páginas de PDF',
  },
  description: {
    en: 'Delete pages from a PDF by number or range. Runs entirely in your browser — the document is never uploaded.',
    vi: 'Xoá trang khỏi PDF theo số hoặc khoảng. Chạy hoàn toàn trong trình duyệt, không tải lên.',
    es: 'Elimina páginas de un PDF por número o rango. Se ejecuta en tu navegador; no se sube nada.',
    pt: 'Remova páginas de um PDF por número ou intervalo. Roda no seu navegador; nada é enviado.',
  },
  keywords: [
    'remove pdf pages',
    'delete pages from pdf',
    'remove page from pdf without uploading',
    'delete pdf pages in browser',
    'pdf page remover',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'split-pdf',
      reason: {
        en: 'Keep the pages instead, as a separate file',
        vi: 'Giữ lại các trang đó thành file riêng',
        es: 'Conservar esas páginas en un archivo aparte',
        pt: 'Guardar essas páginas num arquivo separado',
      },
    },
    {
      tool: 'merge-pdf',
      reason: {
        en: 'Rebuild a document from what is left',
        vi: 'Dựng lại tài liệu từ phần còn lại',
        es: 'Reconstruir un documento con lo que queda',
        pt: 'Reconstruir um documento com o que sobrou',
      },
    },
  ],
};
