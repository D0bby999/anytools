import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'image-to-pdf',
  cluster: 'pdf',
  // Widget strings are localized (strings.ts). Where no vi/es/pt FAQ body exists yet the
  // page serves noindex and stays out of the sitemap (has-localized-tool-body.ts).
  title: {
    en: 'Image to PDF',
    vi: 'Chuyển ảnh sang PDF',
    es: 'Imagen a PDF',
    pt: 'Imagem para PDF',
  },
  description: {
    en: 'Turn JPG, PNG, WebP or GIF photos into a single PDF, one image per page, in the order you choose. Runs entirely in your browser — the photos are never uploaded.',
    vi: 'Ghép nhiều ảnh JPG, PNG, WebP thành một file PDF, mỗi ảnh một trang, theo thứ tự bạn sắp. Chạy hoàn toàn trong trình duyệt — ảnh không hề được tải lên.',
    es: 'Convierte fotos JPG, PNG o WebP en un solo PDF, una imagen por página y en el orden que elijas. Se ejecuta en tu navegador: nada se sube.',
    pt: 'Transforme fotos JPG, PNG ou WebP num único PDF, uma imagem por página, na ordem que escolher. Roda no seu navegador: nada é enviado.',
  },
  keywords: [
    'image to pdf',
    'jpg to pdf',
    'png to pdf',
    'photos to pdf',
    'convert images to pdf offline',
    'image to pdf without uploading',
    'combine images into one pdf',
  ],
  priority: 'P1',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'merge-pdf',
      reason: {
        en: 'Join the result onto an existing document',
        vi: 'Ghép kết quả vào một tài liệu có sẵn',
        es: 'Unir el resultado a un documento existente',
        pt: 'Juntar o resultado a um documento existente',
      },
    },
    {
      tool: 'compress-image',
      reason: {
        en: 'Shrink the photos first if the PDF comes out too large',
        vi: 'Nén ảnh trước nếu file PDF quá nặng',
        es: 'Reduce las fotos antes si el PDF sale muy grande',
        pt: 'Reduza as fotos antes se o PDF ficar muito grande',
      },
    },
    {
      tool: 'add-page-numbers',
      reason: {
        en: 'Number the pages once the images are in a document',
        vi: 'Đánh số trang sau khi ảnh đã thành tài liệu',
        es: 'Numerar las páginas una vez creado el documento',
        pt: 'Numerar as páginas depois de criar o documento',
      },
    },
    {
      tool: 'heic-to-jpg',
      reason: {
        en: 'iPhone .heic photos have to become JPG before they can go in a PDF',
        vi: 'Ảnh .heic của iPhone phải đổi sang JPG trước khi đưa vào PDF',
        es: 'Las fotos .heic del iPhone deben pasar a JPG antes de ir a un PDF',
        pt: 'Fotos .heic do iPhone precisam virar JPG antes de entrar num PDF',
      },
    },
    {
      tool: 'remove-background',
      reason: {
        en: 'Cut product photos out before laying them into a PDF',
        vi: 'Tách nền ảnh sản phẩm trước khi xếp vào PDF',
        es: 'Recortar las fotos de producto antes de armar el PDF',
        pt: 'Recortar as fotos de produto antes de montar o PDF',
      },
    },
  ],
};
