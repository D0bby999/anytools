import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'merge-pdf',
  cluster: 'pdf',
  // English only for now. Without this the route generates vi/es/pt pages carrying an
  // English widget and no body — the shape that had 150 URLs declined for thin content.
  // Drop the field when hand-written translations land.
  availableLocales: ['en'],
  title: {
    en: 'Merge PDF',
    vi: 'Gộp PDF',
    es: 'Combinar PDF',
    pt: 'Juntar PDF',
  },
  description: {
    en: 'Combine several PDFs into one, in the order you choose. Runs entirely in your browser — nothing is uploaded, so there is no server copy to delete.',
    vi: 'Gộp nhiều file PDF thành một, theo thứ tự bạn chọn. Chạy hoàn toàn trong trình duyệt — không tải lên đâu cả.',
    es: 'Combina varios PDF en uno, en el orden que elijas. Se ejecuta en tu navegador: no se sube nada.',
    pt: 'Junte vários PDFs em um, na ordem que escolher. Roda no seu navegador: nada é enviado.',
  },
  keywords: [
    'merge pdf',
    'combine pdf',
    'merge pdf without uploading',
    'combine pdf offline',
    'merge pdf in browser',
    'join pdf files',
    'merge pdf privately',
  ],
  priority: 'P1',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'split-pdf',
      reason: {
        en: 'Pull specific pages back out again',
        vi: 'Tách lại các trang cụ thể',
        es: 'Extraer páginas concretas de nuevo',
        pt: 'Extrair páginas específicas de novo',
      },
    },
    {
      tool: 'remove-pdf-pages',
      reason: {
        en: 'Drop pages you did not want in the result',
        vi: 'Xoá những trang không muốn giữ',
        es: 'Eliminar páginas que no querías',
        pt: 'Remover páginas que não queria',
      },
    },
  ],
};
