import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'remove-background',
  cluster: 'image',
  availableLocales: ['en'],
  title: {
    en: 'Remove Image Background',
    vi: 'Xoá Nền Ảnh',
    es: 'Quitar Fondo de Imagen',
    pt: 'Remover Fundo da Imagem',
  },
  description: {
    en: 'Cut the subject out of a photo and save a transparent PNG. The model runs in your browser — the image never leaves your device.',
    vi: 'Tách chủ thể khỏi ảnh và lưu PNG nền trong suốt. Model chạy ngay trong trình duyệt, ảnh không rời máy bạn.',
    es: 'Recorta el sujeto de una foto y guarda un PNG transparente. El modelo se ejecuta en tu navegador.',
    pt: 'Recorta o objeto da foto e salva um PNG transparente. O modelo roda no seu navegador.',
  },
  keywords: [
    'remove background from image',
    'transparent png maker',
    'background remover offline',
    'cut out subject from photo',
    'remove background without uploading',
    'product photo white background',
  ],
  priority: 'P2',
  effort: 'L',
  // Published 2026-09-03 on the owner's call, ahead of the quality gate ("2 of 4 real photos —
  // portrait, product, pet, hair — usable without hand-fixing"): the owner judges the cutouts on
  // the live server instead of in the lane. If the results disappoint, set `published: false`
  // again — every public surface (sitemap, llms.txt, cluster index, home catalogue, ⌘K, Related
  // Tools) filters on it, and the route keeps rendering for a direct link.
  published: true,
  nextStepSuggestions: [
    {
      tool: 'crop-image',
      reason: {
        en: 'Trim the empty space left around the cutout',
        vi: 'Cắt bớt khoảng trống quanh ảnh đã tách nền',
        es: 'Recortar el espacio vacío alrededor del recorte',
        pt: 'Cortar o espaço vazio ao redor do recorte',
      },
    },
    {
      tool: 'compress-image',
      reason: {
        en: 'A transparent PNG is large — shrink it before uploading',
        vi: 'PNG trong suốt khá nặng — nén lại trước khi tải lên',
        es: 'Un PNG transparente es pesado: redúcelo antes de subirlo',
        pt: 'PNG transparente é pesado — reduza antes de enviar',
      },
    },
    {
      tool: 'image-to-pdf',
      reason: {
        en: 'Put the finished cutouts into one PDF',
        vi: 'Gộp các ảnh đã tách nền vào một PDF',
        es: 'Reunir los recortes en un PDF',
        pt: 'Juntar os recortes em um PDF',
      },
    },
  ],
};
