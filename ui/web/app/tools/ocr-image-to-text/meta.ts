import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'ocr-image-to-text',
  cluster: 'image',
  // Widget strings are localized (strings.ts). Where no vi/es/pt FAQ body exists yet the
  // page serves noindex and stays out of the sitemap (has-localized-tool-body.ts).
  title: {
    en: 'Image to Text (OCR)',
    vi: 'Ảnh sang chữ (OCR)',
    es: 'Imagen a texto (OCR)',
    pt: 'Imagem para texto (OCR)',
  },
  description: {
    en: 'Read the text out of photos and screenshots in English, Vietnamese, Spanish or Portuguese. The recogniser runs in your browser — no image is uploaded.',
    vi: 'Trích chữ từ ảnh chụp và ảnh màn hình, hỗ trợ tiếng Anh, Việt, Tây Ban Nha, Bồ Đào Nha. Chạy ngay trong trình duyệt, không tải ảnh lên.',
    es: 'Extrae el texto de fotos y capturas en inglés, vietnamita, español o portugués. Todo ocurre en tu navegador; no se sube ninguna imagen.',
    pt: 'Extraia o texto de fotos e capturas em inglês, vietnamita, espanhol ou português. Tudo roda no seu navegador; nenhuma imagem é enviada.',
  },
  keywords: [
    'image to text',
    'ocr online',
    'extract text from image',
    'photo to text converter',
    'screenshot to text',
    'ocr without uploading',
    'vietnamese ocr',
  ],
  priority: 'P1',
  effort: 'L',
  nextStepSuggestions: [
    { tool: 'ocr-pdf', reason: { en: 'Read a whole scanned PDF instead of single images' } },
    {
      tool: 'compress-image',
      reason: { en: 'Shrink the photo once you have the text out of it' },
    },
    { tool: 'word-counter', reason: { en: 'Count the words in the recognised text' } },
  ],
};
