import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'add-page-numbers',
  cluster: 'pdf',
  // Widget strings are localized (strings.ts). Where no vi/es/pt FAQ body exists yet the
  // page serves noindex and stays out of the sitemap (has-localized-tool-body.ts).
  title: {
    en: 'Add Page Numbers to PDF',
    vi: 'Đánh số trang PDF',
    es: 'Añadir números de página a un PDF',
    pt: 'Adicionar números de página a um PDF',
  },
  description: {
    en: 'Stamp page numbers onto a PDF — six positions, three formats, any starting number and any page range. Runs entirely in your browser, so the document is never uploaded.',
    vi: 'Đánh số trang lên file PDF — 6 vị trí, 3 kiểu hiển thị, chọn số bắt đầu và dải trang. Chạy hoàn toàn trong trình duyệt, tài liệu không hề được tải lên.',
    es: 'Añade números de página a un PDF: seis posiciones, tres formatos, número inicial y rango a elegir. Se ejecuta en tu navegador: el documento no se sube.',
    pt: 'Adicione números de página a um PDF: seis posições, três formatos, número inicial e intervalo à escolha. Roda no seu navegador: o documento não é enviado.',
  },
  keywords: [
    'add page numbers to pdf',
    'number pdf pages',
    'pdf page numbering',
    'insert page numbers pdf',
    'add page numbers offline',
    'number pdf without uploading',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'merge-pdf',
      reason: {
        en: 'Combine the documents first, then number the result once',
        vi: 'Gộp tài liệu trước rồi đánh số một lần cho cả file',
        es: 'Combina primero y numera el resultado una sola vez',
        pt: 'Junte primeiro e numere o resultado de uma só vez',
      },
    },
    {
      tool: 'watermark-pdf',
      reason: {
        en: 'Add a draft or confidential stamp as well',
        vi: 'Đóng thêm dấu "draft" hoặc "confidential"',
        es: 'Añadir además un sello de borrador o confidencial',
        pt: 'Adicionar também um selo de rascunho ou confidencial',
      },
    },
    {
      tool: 'split-pdf',
      reason: {
        en: 'Split the numbered document into sections',
        vi: 'Tách tài liệu đã đánh số thành từng phần',
        es: 'Dividir el documento numerado en secciones',
        pt: 'Dividir o documento numerado em secções',
      },
    },
  ],
};
