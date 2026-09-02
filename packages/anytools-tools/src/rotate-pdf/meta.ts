import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'rotate-pdf',
  cluster: 'pdf',
  availableLocales: ['en'],
  title: { en: 'Rotate PDF', vi: 'Xoay PDF', es: 'Rotar PDF', pt: 'Girar PDF' },
  description: {
    en: 'Turn PDF pages 90, 180 or 270 degrees — all of them or just the ones you name. Runs in your browser, nothing is uploaded.',
    vi: 'Xoay trang PDF 90, 180 hoặc 270 độ — tất cả hoặc chỉ những trang bạn chọn. Chạy trong trình duyệt.',
    es: 'Gira páginas PDF 90, 180 o 270 grados: todas o solo las que indiques. Se ejecuta en tu navegador.',
    pt: 'Gire páginas de PDF em 90, 180 ou 270 graus: todas ou apenas as que indicar. Roda no navegador.',
  },
  keywords: [
    'rotate pdf',
    'rotate pdf pages',
    'turn pdf sideways',
    'rotate pdf without uploading',
    'fix sideways pdf scan',
    'rotate pdf in browser',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'split-pdf',
      reason: {
        en: 'Pull the corrected pages out on their own',
        vi: 'Tách riêng các trang đã sửa',
        es: 'Extraer las páginas corregidas por separado',
        pt: 'Extrair as páginas corrigidas separadamente',
      },
    },
    {
      tool: 'merge-pdf',
      reason: {
        en: 'Combine it with other documents',
        vi: 'Gộp với tài liệu khác',
        es: 'Combinarlo con otros documentos',
        pt: 'Combinar com outros documentos',
      },
    },
  ],
};
