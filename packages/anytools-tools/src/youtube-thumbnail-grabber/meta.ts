import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'youtube-thumbnail-grabber',
  cluster: 'image',
  // Widget strings are localized (strings.ts). Where no vi/es/pt FAQ body exists yet the
  // page serves noindex and stays out of the sitemap (has-localized-tool-body.ts).
  title: {
    en: 'YouTube Thumbnail Grabber',
    vi: 'Lấy ảnh thumbnail YouTube',
    es: 'Extractor de miniaturas de YouTube',
    pt: 'Extrator de miniaturas do YouTube',
  },
  description: {
    en: 'Paste a YouTube link (watch, youtu.be, Shorts or embed) and get all four thumbnail sizes, up to 1280×720, with a working preview even when the top quality is missing.',
    vi: 'Dán link YouTube (watch, youtu.be, Shorts hay embed) để lấy đủ 4 cỡ ảnh thumbnail, tới 1280×720, có xem trước dù bản chất lượng cao nhất bị thiếu.',
    es: 'Pega un enlace de YouTube (watch, youtu.be, Shorts o embed) y obtén las cuatro resoluciones de miniatura, hasta 1280×720.',
    pt: 'Cole um link do YouTube (watch, youtu.be, Shorts ou embed) e obtenha os quatro tamanhos de miniatura, até 1280×720.',
  },
  keywords: [
    'youtube thumbnail downloader',
    'youtube thumbnail grabber',
    'get youtube thumbnail',
    'youtube thumbnail hd',
    'youtube maxresdefault',
    'download youtube thumbnail',
  ],
  priority: 'P3',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'compress-image',
      reason: {
        en: 'Shrink the downloaded thumbnail before reusing it elsewhere',
        vi: 'Nén ảnh thumbnail vừa tải trước khi dùng lại ở nơi khác',
        es: 'Reduce la miniatura descargada antes de reutilizarla',
        pt: 'Comprima a miniatura baixada antes de reutilizá-la',
      },
    },
    {
      tool: 'crop-image',
      reason: {
        en: 'Crop the thumbnail to a square or a different aspect ratio',
        vi: 'Cắt ảnh thumbnail về hình vuông hay tỉ lệ khác',
        es: 'Recorta la miniatura a un cuadrado u otra proporción',
        pt: 'Recorte a miniatura para um quadrado ou outra proporção',
      },
    },
    {
      tool: 'image-format-converter',
      reason: {
        en: 'Convert the downloaded JPG to WebP or PNG',
        vi: 'Đổi file JPG vừa tải sang WebP hoặc PNG',
        es: 'Convierte el JPG descargado a WebP o PNG',
        pt: 'Converta o JPG baixado para WebP ou PNG',
      },
    },
  ],
};
