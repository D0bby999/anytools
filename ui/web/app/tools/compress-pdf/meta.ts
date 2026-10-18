import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'compress-pdf',
  cluster: 'pdf',
  // Widget strings are localized (strings.ts). Where no vi/es/pt FAQ body exists yet the page
  // serves noindex and stays out of the sitemap (has-localized-tool-body.ts).
  title: {
    en: 'Compress PDF',
    vi: 'Nén PDF',
    es: 'Comprimir PDF',
    pt: 'Comprimir PDF',
  },
  description: {
    en: 'Shrink a scanned or image-heavy PDF by recompressing its embedded JPEG and raw (FlateDecode) images with MozJPEG or lossless PNG, optionally capping their resolution. Runs in your browser — the file is never uploaded.',
    vi: 'Nén PDF bằng cách mã hoá lại ảnh JPEG và ảnh thô (FlateDecode) nhúng trong file với MozJPEG hoặc PNG không mất dữ liệu, có thể hạ độ phân giải. Chạy trong trình duyệt, không tải file lên.',
    es: 'Reduce un PDF escaneado o con muchas imágenes recodificando sus imágenes JPEG y sin comprimir (FlateDecode) con MozJPEG o PNG sin pérdida, con opción de limitar la resolución. Se ejecuta en tu navegador.',
    pt: 'Reduza um PDF escaneado ou com muitas imagens recodificando suas imagens JPEG e brutas (FlateDecode) com MozJPEG ou PNG sem perdas, com opção de limitar a resolução. Roda no navegador.',
  },
  keywords: [
    'compress pdf',
    'reduce pdf size',
    'shrink pdf file size',
    'compress scanned pdf',
    'compress pdf images',
    'pdf file size reducer',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'extract-images-from-pdf',
      reason: {
        en: 'Pull the images out instead of compressing them in place',
        vi: 'Bóc ảnh ra thay vì nén ngay trong file',
        es: 'Extraer las imágenes en vez de comprimirlas en el archivo',
        pt: 'Extrair as imagens em vez de comprimi-las no arquivo',
      },
    },
    {
      tool: 'merge-pdf',
      reason: {
        en: 'Combine several compressed PDFs into one',
        vi: 'Ghép nhiều PDF đã nén thành một file',
        es: 'Combinar varios PDF comprimidos en uno',
        pt: 'Combinar vários PDFs comprimidos em um só',
      },
    },
    {
      tool: 'split-pdf',
      reason: {
        en: 'Split the compressed PDF back into smaller pieces',
        vi: 'Tách PDF đã nén thành nhiều phần nhỏ hơn',
        es: 'Dividir el PDF comprimido en partes más pequeñas',
        pt: 'Dividir o PDF comprimido em partes menores',
      },
    },
    {
      tool: 'pdf-to-png',
      reason: {
        en: 'Render pages as images instead of compressing the file',
        vi: 'Xuất trang thành ảnh thay vì nén file',
        es: 'Convertir páginas en imágenes en vez de comprimir el archivo',
        pt: 'Converter páginas em imagens em vez de comprimir o arquivo',
      },
    },
  ],
};
