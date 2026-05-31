import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'image-format-converter',
  cluster: 'converters',
  title: {
    en: 'Image Format Converter',
    vi: 'Convert Định Dạng Ảnh',
    es: 'Conversor de Formato de Imagen',
    pt: 'Conversor de Formato de Imagem',
  },
  description: {
    en: 'Convert images between PNG, JPEG, and WebP in your browser. Quality slider for lossy formats. AVIF input supported (decode). Max 10 MB. 100% local.',
    vi: 'Convert ảnh giữa PNG, JPEG, WebP trong browser. Slider chất lượng cho định dạng lossy. Đọc được AVIF. Max 10 MB. 100% offline.',
    es: 'Convierte imágenes entre PNG, JPEG y WebP en el navegador. Slider de calidad para lossy. AVIF como entrada. Max 10 MB.',
    pt: 'Converta imagens entre PNG, JPEG e WebP no navegador. Slider de qualidade para lossy. AVIF como entrada. Max 10 MB.',
  },
  keywords: [
    'image converter',
    'png to webp',
    'jpg to webp',
    'webp to png',
    'image format converter',
    'avif decoder',
    'convert image browser',
  ],
  priority: 'P3',
  effort: 'L',
  nextStepSuggestions: [
    {
      tool: 'base64-encode',
      reason: {
        en: 'Encode small images as Base64 data URIs',
        vi: 'Encode ảnh nhỏ sang Base64 data URI',
        es: 'Codificar imágenes pequeñas como Base64',
        pt: 'Codificar imagens pequenas como Base64',
      },
    },
    {
      tool: 'qr-code-generator',
      reason: {
        en: 'Generate a QR code instead',
        vi: 'Tạo mã QR thay vì',
        es: 'Generar un código QR',
        pt: 'Gerar um QR code',
      },
    },
  ],
};
