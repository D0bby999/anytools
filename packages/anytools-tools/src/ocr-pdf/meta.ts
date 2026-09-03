import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'ocr-pdf',
  cluster: 'pdf',
  availableLocales: ['en'],
  title: {
    en: 'OCR a Scanned PDF',
    vi: 'OCR file PDF scan',
    es: 'OCR de un PDF escaneado',
    pt: 'OCR de um PDF digitalizado',
  },
  description: {
    en: 'Read the text out of a scanned PDF and either save it as .txt or get the same PDF back with an invisible, searchable text layer. Runs in your browser.',
    vi: 'Đọc chữ trong PDF scan, xuất ra .txt hoặc trả lại chính file PDF đó kèm lớp chữ tìm kiếm được. Chạy trong trình duyệt.',
    es: 'Extrae el texto de un PDF escaneado y guárdalo como .txt, o recupera el mismo PDF con una capa de texto invisible y buscable. Todo en tu navegador.',
    pt: 'Extraia o texto de um PDF digitalizado e salve como .txt, ou receba o mesmo PDF com uma camada de texto invisível e pesquisável. Tudo no navegador.',
  },
  keywords: [
    'ocr pdf',
    'scanned pdf to text',
    'make pdf searchable',
    'searchable pdf online',
    'extract text from scanned pdf',
    'pdf ocr without uploading',
  ],
  priority: 'P1',
  effort: 'L',
  nextStepSuggestions: [
    {
      tool: 'ocr-image-to-text',
      reason: { en: 'Read a photo or screenshot instead of a PDF' },
    },
    { tool: 'pdf-to-png', reason: { en: 'Save the scanned pages as images' } },
    {
      tool: 'extract-images-from-pdf',
      reason: { en: 'Pull the scan images out at their original resolution' },
    },
  ],
};
