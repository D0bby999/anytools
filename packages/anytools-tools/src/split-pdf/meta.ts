import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'split-pdf',
  cluster: 'pdf',
  availableLocales: ['en'],
  title: { en: 'Split PDF', vi: 'Tách PDF', es: 'Dividir PDF', pt: 'Dividir PDF' },
  description: {
    en: 'Extract page ranges from a PDF, or split it into one file per page. Runs in your browser — the document is never uploaded.',
    vi: 'Tách khoảng trang khỏi PDF, hoặc chia mỗi trang một file. Chạy trong trình duyệt, không tải lên.',
    es: 'Extrae rangos de páginas de un PDF o divídelo en un archivo por página. Se ejecuta en tu navegador.',
    pt: 'Extraia intervalos de páginas de um PDF ou divida em um arquivo por página. Roda no seu navegador.',
  },
  keywords: [
    'split pdf',
    'extract pages from pdf',
    'split pdf without uploading',
    'split pdf in browser',
    'pdf page extractor',
    'separate pdf pages',
  ],
  priority: 'P1',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'merge-pdf',
      reason: {
        en: 'Recombine the parts in a different order',
        vi: 'Ghép lại các phần theo thứ tự khác',
        es: 'Recombinar las partes en otro orden',
        pt: 'Recombinar as partes noutra ordem',
      },
    },
    {
      tool: 'remove-pdf-pages',
      reason: {
        en: 'Delete pages instead of extracting them',
        vi: 'Xoá trang thay vì tách ra',
        es: 'Eliminar páginas en vez de extraerlas',
        pt: 'Remover páginas em vez de extrair',
      },
    },
    {
      tool: 'add-page-numbers',
      reason: {
        en: 'Renumber a section that no longer starts at page 1',
        vi: 'Đánh số lại phần không còn bắt đầu từ trang 1',
        es: 'Renumerar una sección que ya no empieza en la página 1',
        pt: 'Renumerar uma secção que já não começa na página 1',
      },
    },
  ],
};
