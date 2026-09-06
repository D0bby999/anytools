import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'image-to-base64',
  cluster: 'converters',
  // Widget strings are localized (strings.ts). Where no vi/es/pt FAQ body exists yet the
  // page serves noindex and stays out of the sitemap (has-localized-tool-body.ts).
  title: {
    en: 'Image to Base64',
    vi: 'Ảnh sang Base64',
    es: 'Imagen a Base64',
    pt: 'Imagem para Base64',
  },
  description: {
    en: 'Turn an image into a base64 data URI ready to paste into HTML, CSS or Markdown — and back again. Runs entirely in your browser.',
    vi: 'Đổi ảnh thành data URI base64, dán thẳng vào HTML, CSS hoặc Markdown — và đổi ngược lại. Chạy hoàn toàn trong trình duyệt.',
    es: 'Convierte una imagen en un data URI base64 listo para pegar en HTML, CSS o Markdown — y viceversa. Se ejecuta en tu navegador.',
    pt: 'Transforme uma imagem num data URI base64 pronto para colar em HTML, CSS ou Markdown — e o inverso. Roda no seu navegador.',
  },
  keywords: [
    'image to base64',
    'base64 image encoder',
    'base64 to image',
    'image to data uri',
    'convert image to base64 online',
    'css background image base64',
    'base64 image decoder',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'compress-image',
      reason: {
        en: 'Shrink the image first — smaller file, smaller data URI',
        vi: 'Nén ảnh trước — ảnh nhỏ thì data URI cũng nhỏ',
        es: 'Reducir la imagen primero — archivo más pequeño, data URI más corto',
        pt: 'Reduzir a imagem primeiro — arquivo menor, data URI menor',
      },
    },
    {
      tool: 'image-format-converter',
      reason: {
        en: 'Switch to WebP before encoding for the smallest data URI',
        vi: 'Đổi sang WebP trước khi encode để data URI nhỏ nhất',
        es: 'Cambiar a WebP antes de codificar para el data URI más pequeño',
        pt: 'Mudar para WebP antes de codificar para o menor data URI',
      },
    },
    {
      tool: 'base64-encode',
      reason: {
        en: 'Encode plain text as base64 instead',
        vi: 'Encode văn bản thường sang base64',
        es: 'Codificar texto normal en base64',
        pt: 'Codificar texto simples em base64',
      },
    },
  ],
};
