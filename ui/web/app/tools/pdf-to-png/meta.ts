import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'pdf-to-png',
  cluster: 'pdf',
  availableLocales: ['en'],
  title: {
    en: 'PDF to PNG',
    vi: 'PDF sang PNG',
    es: 'PDF a PNG',
    pt: 'PDF para PNG',
  },
  description: {
    en: 'Render each page of a PDF to a PNG image at 72, 150 or 300 DPI. Runs in your browser — the document is never uploaded.',
    vi: 'Xuất từng trang PDF thành ảnh PNG ở 72, 150 hoặc 300 DPI. Chạy trong trình duyệt, tài liệu không bao giờ được tải lên.',
    es: 'Convierte cada página de un PDF en una imagen PNG a 72, 150 o 300 DPI. Se ejecuta en tu navegador: el documento nunca se sube.',
    pt: 'Converte cada página de um PDF em uma imagem PNG a 72, 150 ou 300 DPI. Roda no seu navegador: o documento nunca é enviado.',
  },
  keywords: [
    'pdf to png',
    'pdf to image',
    'convert pdf to png without uploading',
    'pdf page to image',
    'pdf to png 300 dpi',
    'pdf to png in browser',
  ],
  priority: 'P1',
  effort: 'L',
  nextStepSuggestions: [
    {
      tool: 'extract-images-from-pdf',
      reason: { en: 'Get the embedded images instead of page renders' },
    },
    { tool: 'compress-image', reason: { en: 'Shrink the resulting PNGs' } },
    // A multi-page render comes back as a .zip; this is where that zip gets opened.
    { tool: 'unzip-archive', reason: { en: 'Open the .zip of pages this produces' } },
    { tool: 'ocr-pdf', reason: { en: 'Read the text out of a scanned PDF instead' } },
  ],
};
