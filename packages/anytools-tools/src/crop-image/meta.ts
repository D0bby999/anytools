import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'crop-image',
  cluster: 'image',
  availableLocales: ['en'],
  title: { en: 'Crop Image', vi: 'Cắt Ảnh', es: 'Recortar Imagen', pt: 'Cortar Imagem' },
  description: {
    en: 'Drag a box to crop, with presets for 1:1, 4:5 and 16:9. Works with a mouse or a touchscreen. Runs in your browser.',
    vi: 'Kéo khung để cắt, có sẵn tỷ lệ 1:1, 4:5, 16:9. Dùng được cả chuột lẫn cảm ứng. Chạy trong trình duyệt.',
    es: 'Arrastra un recuadro para recortar, con ajustes 1:1, 4:5 y 16:9. Funciona con ratón o pantalla táctil.',
    pt: 'Arraste um retângulo para cortar, com predefinições 1:1, 4:5 e 16:9. Funciona com mouse ou toque.',
  },
  keywords: [
    'crop image',
    'crop photo online',
    'crop image to square',
    'crop image without uploading',
    'crop image 16:9',
    'image cropper',
  ],
  priority: 'P2',
  effort: 'L',
  nextStepSuggestions: [
    {
      tool: 'resize-image',
      reason: {
        en: 'Scale the cropped result to a target size',
        vi: 'Đổi cỡ ảnh đã cắt',
        es: 'Escalar el recorte a un tamaño concreto',
        pt: 'Redimensionar o recorte',
      },
    },
    {
      tool: 'compress-image',
      reason: {
        en: 'Shrink the file before uploading it somewhere',
        vi: 'Nén file trước khi tải lên đâu đó',
        es: 'Reducir el archivo antes de subirlo',
        pt: 'Reduzir o arquivo antes de enviar',
      },
    },
  ],
};
