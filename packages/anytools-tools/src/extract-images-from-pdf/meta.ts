import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'extract-images-from-pdf',
  cluster: 'pdf',
  availableLocales: ['en'],
  title: {
    en: 'Extract Images from PDF',
    vi: 'Trích Ảnh từ PDF',
    es: 'Extraer Imágenes de PDF',
    pt: 'Extrair Imagens de PDF',
  },
  description: {
    en: 'Pull the images embedded in a PDF at their original resolution — not screenshots of the pages. Runs entirely in your browser.',
  },
  keywords: [
    'extract images from pdf',
    'pdf image extractor',
    'get pictures out of pdf',
    'extract pdf images without uploading',
    'save images from pdf',
  ],
  priority: 'P2',
  effort: 'L',
  nextStepSuggestions: [
    { tool: 'pdf-to-png', reason: { en: 'Render whole pages instead of embedded images' } },
    { tool: 'resize-image', reason: { en: 'Scale the extracted images' } },
    { tool: 'ocr-pdf', reason: { en: 'Read the text out of the scan instead of saving it' } },
  ],
};
