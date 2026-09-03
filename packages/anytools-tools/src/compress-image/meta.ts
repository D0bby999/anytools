import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'compress-image',
  cluster: 'image',
  availableLocales: ['en'],
  title: { en: 'Compress Image', vi: 'Nén Ảnh', es: 'Comprimir Imagen', pt: 'Comprimir Imagem' },
  description: {
    en: 'Shrink a photo to fit an upload limit, with the before and after shown side by side. Runs in your browser — the image is never uploaded.',
    vi: 'Nén ảnh xuống dưới mức dung lượng cho phép, xem trước và sau cạnh nhau. Chạy trong trình duyệt.',
    es: 'Reduce una foto para cumplir un límite de subida, con el antes y el después juntos. Se ejecuta en tu navegador.',
    pt: 'Reduza uma foto para caber num limite de upload, com antes e depois lado a lado. Roda no navegador.',
  },
  keywords: [
    'compress image',
    'compress image without losing quality',
    'reduce image size',
    'compress jpeg',
    'compress image offline',
    'shrink photo file size',
  ],
  priority: 'P1',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'resize-image',
      reason: {
        en: 'Reduce the dimensions as well as the file size',
        vi: 'Giảm cả kích thước lẫn dung lượng',
        es: 'Reducir también las dimensiones',
        pt: 'Reduzir também as dimensões',
      },
    },
    {
      tool: 'image-format-converter',
      reason: {
        en: 'Switch format instead of re-encoding',
        vi: 'Đổi định dạng thay vì mã hoá lại',
        es: 'Cambiar de formato en vez de recodificar',
        pt: 'Trocar de formato em vez de recodificar',
      },
    },
    {
      tool: 'ocr-image-to-text',
      reason: {
        en: 'Read the text out of the photo before compressing it',
        vi: 'Trích chữ trong ảnh trước khi nén',
        es: 'Extraer el texto de la foto antes de comprimirla',
        pt: 'Extrair o texto da foto antes de comprimi-la',
      },
    },
    {
      tool: 'create-zip',
      reason: {
        en: 'Bundle the compressed photos into one file to send',
        vi: 'Gộp ảnh đã nén thành một file để gửi',
        es: 'Agrupar las fotos comprimidas en un solo archivo',
        pt: 'Juntar as fotos comprimidas num único arquivo',
      },
    },
    {
      tool: 'image-to-pdf',
      reason: {
        en: 'Collect the compressed photos into one PDF',
        vi: 'Gom ảnh đã nén thành một file PDF',
        es: 'Reunir las fotos comprimidas en un PDF',
        pt: 'Reunir as fotos comprimidas num PDF',
      },
    },
    {
      tool: 'heic-to-jpg',
      reason: {
        en: 'This tool cannot open .heic — convert an iPhone photo first',
        vi: 'Tool này không mở được .heic — chuyển ảnh iPhone trước',
        es: 'Esta herramienta no abre .heic — convierte antes la foto del iPhone',
        pt: 'Esta ferramenta não abre .heic — converta a foto do iPhone antes',
      },
    },
  ],
};
