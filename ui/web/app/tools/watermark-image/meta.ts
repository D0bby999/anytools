import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'watermark-image',
  cluster: 'image',
  // Widget strings are localized (strings.ts). Where no vi/es/pt FAQ body exists yet the
  // page serves noindex and stays out of the sitemap (has-localized-tool-body.ts).
  title: {
    en: 'Watermark Image',
    vi: 'Đóng dấu mờ lên ảnh',
    es: 'Marca de agua en imagen',
    pt: 'Marca d’água em imagem',
  },
  description: {
    en: 'Stamp text or a logo across a photo — position, opacity, size, angle, colour and tiling, with a live preview. Runs entirely in your browser.',
    vi: 'Đóng chữ hoặc logo mờ lên ảnh — chọn vị trí, độ mờ, cỡ, góc nghiêng, màu và kiểu lặp, xem trước trực tiếp. Chạy hoàn toàn trong trình duyệt.',
    es: 'Estampa texto o un logotipo sobre una foto: posición, opacidad, tamaño, ángulo, color y mosaico, con vista previa en vivo. Se ejecuta en tu navegador.',
    pt: 'Aplique texto ou um logótipo sobre uma foto: posição, opacidade, tamanho, ângulo, cor e repetição, com pré-visualização ao vivo. Roda no seu navegador.',
  },
  keywords: [
    'watermark image',
    'watermark photo online',
    'add watermark to picture',
    'add logo to photo',
    'tile watermark image',
    'watermark image without uploading',
    'add text to photo',
  ],
  priority: 'P2',
  effort: 'L',
  nextStepSuggestions: [
    {
      tool: 'watermark-pdf',
      reason: {
        en: 'Stamp the same mark on a PDF instead',
        vi: 'Đóng dấu tương tự lên tệp PDF',
        es: 'Estampar la misma marca en un PDF',
        pt: 'Aplicar a mesma marca num PDF',
      },
    },
    {
      tool: 'compress-image',
      reason: {
        en: 'Shrink the stamped photo before sharing',
        vi: 'Giảm dung lượng ảnh đã đóng dấu trước khi chia sẻ',
        es: 'Reducir la foto marcada antes de compartir',
        pt: 'Reduzir a foto marcada antes de compartilhar',
      },
    },
    {
      tool: 'rotate-image',
      reason: {
        en: 'Fix the orientation first if the photo is sideways',
        vi: 'Sửa hướng ảnh trước nếu ảnh bị lệch',
        es: 'Corregir la orientación primero si la foto está de lado',
        pt: 'Corrigir a orientação primeiro se a foto estiver de lado',
      },
    },
  ],
};
