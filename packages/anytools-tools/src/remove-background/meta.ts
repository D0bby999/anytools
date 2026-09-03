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
  // DARK-LAUNCHED. Phase 9's quality gate ("2 of 4 real photos — portrait, product, pet, hair —
  // usable without hand-fixing") has never been run: the lane graded two synthetic silhouettes by
  // what percentage of the mask they kept, which measures that the pipeline runs, not that the
  // cutout is good enough to publish. Until someone judges four real photographs, this tool stays
  // out of the sitemap, llms.txt, the cluster index and Related Tools; the route still renders for
  // anyone given the link. Re-enable steps: plans/…/phase-09-remove-background.md § Re-enable.
  published: false,
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
