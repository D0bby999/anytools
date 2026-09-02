import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'resize-image',
  cluster: 'image',
  availableLocales: ['en'],
  title: {
    en: 'Resize Image',
    vi: 'Đổi Cỡ Ảnh',
    es: 'Redimensionar Imagen',
    pt: 'Redimensionar Imagem',
  },
  description: {
    en: 'Scale an image to exact pixels, a percentage, or to fit inside a box. Runs in your browser — nothing is uploaded.',
    vi: 'Đổi cỡ ảnh theo pixel, phần trăm, hoặc vừa trong một khung. Chạy trong trình duyệt, không tải lên.',
    es: 'Escala una imagen a píxeles exactos, un porcentaje o para caber en una caja. Se ejecuta en tu navegador.',
    pt: 'Redimensione uma imagem para pixels exatos, uma porcentagem ou para caber numa caixa. Roda no navegador.',
  },
  keywords: [
    'resize image',
    'resize image online',
    'resize image without uploading',
    'scale image to exact pixels',
    'resize photo in browser',
    'image resizer',
  ],
  priority: 'P1',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'compress-image',
      reason: {
        en: 'Cut the file size further',
        vi: 'Giảm dung lượng thêm nữa',
        es: 'Reducir más el tamaño del archivo',
        pt: 'Reduzir ainda mais o tamanho',
      },
    },
    {
      tool: 'crop-image',
      reason: {
        en: 'Change the framing, not just the scale',
        vi: 'Đổi khung hình chứ không chỉ tỷ lệ',
        es: 'Cambiar el encuadre, no solo la escala',
        pt: 'Mudar o enquadramento, não só a escala',
      },
    },
  ],
};
