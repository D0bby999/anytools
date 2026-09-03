import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'heic-to-jpg',
  cluster: 'image',
  availableLocales: ['en'],
  title: {
    en: 'HEIC to JPG',
    vi: 'Chuyển HEIC sang JPG',
    es: 'HEIC a JPG',
    pt: 'HEIC para JPG',
  },
  description: {
    en: 'Open the .heic photos an iPhone produces and save them as JPG or PNG. Decoded in your browser — the photos are never uploaded.',
    vi: 'Mở ảnh .heic của iPhone và lưu thành JPG hoặc PNG. Giải mã ngay trong trình duyệt, ảnh không được tải lên.',
    es: 'Abre las fotos .heic del iPhone y guárdalas como JPG o PNG. Se decodifica en tu navegador; las fotos no se suben.',
    pt: 'Abra as fotos .heic do iPhone e salve como JPG ou PNG. Decodificado no navegador; as fotos não são enviadas.',
  },
  keywords: [
    'heic to jpg',
    'convert heic to jpg',
    'heic converter',
    'open heic on windows',
    'heic to png',
    'heif converter',
    'iphone photo to jpg',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'compress-image',
      reason: {
        en: 'A converted JPG is often larger than the HEIC — shrink it',
        vi: 'JPG sau khi chuyển thường nặng hơn HEIC — nén lại',
        es: 'El JPG resultante suele pesar más que el HEIC — comprímelo',
        pt: 'O JPG convertido costuma ser maior que o HEIC — comprima',
      },
    },
    {
      tool: 'resize-image',
      reason: {
        en: 'Cut a 12-megapixel photo down to the size you actually need',
        vi: 'Giảm ảnh 12 megapixel xuống kích thước thực sự cần',
        es: 'Reducir una foto de 12 megapíxeles al tamaño que necesitas',
        pt: 'Reduzir uma foto de 12 megapixels ao tamanho necessário',
      },
    },
    {
      tool: 'image-format-converter',
      reason: {
        en: 'Take the JPG on to WebP, PNG or back again',
        vi: 'Đưa JPG sang WebP, PNG hoặc ngược lại',
        es: 'Llevar el JPG a WebP, PNG o de vuelta',
        pt: 'Levar o JPG para WebP, PNG ou de volta',
      },
    },
    {
      tool: 'image-to-pdf',
      reason: {
        en: 'Collect the converted photos into one PDF',
        vi: 'Gom ảnh đã chuyển thành một file PDF',
        es: 'Reunir las fotos convertidas en un PDF',
        pt: 'Reunir as fotos convertidas num PDF',
      },
    },
  ],
};
