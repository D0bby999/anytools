import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'rotate-image',
  cluster: 'image',
  // Widget strings are localized (strings.ts). Where no vi/es/pt FAQ body exists yet the
  // page serves noindex and stays out of the sitemap (has-localized-tool-body.ts).
  title: { en: 'Rotate Image', vi: 'Xoay Ảnh', es: 'Rotar Imagen', pt: 'Girar Imagem' },
  description: {
    en: 'Turn photos 90, 180 or 270 degrees, or flip them, one at a time or in a batch. Runs in your browser — nothing is uploaded.',
    vi: 'Xoay ảnh 90, 180 hoặc 270 độ, hoặc lật ngang/dọc — từng ảnh hoặc cả loạt. Chạy trong trình duyệt, không tải lên.',
    es: 'Gira fotos 90, 180 o 270 grados, o voltéalas, una a una o en lote. Se ejecuta en tu navegador.',
    pt: 'Gire fotos em 90, 180 ou 270 graus, ou vire-as, uma a uma ou em lote. Roda no navegador.',
  },
  keywords: [
    'rotate image',
    'rotate photo online',
    'flip image horizontal',
    'flip image vertical',
    'fix sideways phone photo',
    'rotate image without uploading',
    'batch rotate images',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'crop-image',
      reason: {
        en: 'Straighten the framing after rotating',
        vi: 'Chỉnh lại khung hình sau khi xoay',
        es: 'Ajustar el encuadre después de rotar',
        pt: 'Ajustar o enquadramento depois de girar',
      },
    },
    {
      tool: 'compress-image',
      reason: {
        en: 'Shrink the file size before sharing',
        vi: 'Giảm dung lượng trước khi chia sẻ',
        es: 'Reducir el tamaño antes de compartir',
        pt: 'Reduzir o tamanho antes de compartilhar',
      },
    },
    {
      tool: 'rotate-pdf',
      reason: {
        en: 'Rotate pages of a PDF the same way',
        vi: 'Xoay trang PDF theo cách tương tự',
        es: 'Rotar páginas de un PDF de la misma forma',
        pt: 'Girar páginas de um PDF da mesma forma',
      },
    },
  ],
};
