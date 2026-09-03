import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'watermark-pdf',
  cluster: 'pdf',
  // English only for now. Without this the route generates vi/es/pt pages carrying an
  // English widget and no body — the shape that had 150 URLs declined for thin content.
  // Drop the field when hand-written translations land.
  availableLocales: ['en'],
  title: {
    en: 'Watermark PDF',
    vi: 'Đóng dấu mờ lên PDF',
    es: 'Marca de agua en PDF',
    pt: 'Marca d’água em PDF',
  },
  description: {
    en: 'Stamp text or a logo across the pages of a PDF — choose the size, angle, colour and opacity, and see it on page one before you commit. Runs entirely in your browser.',
    vi: 'Đóng chữ hoặc logo mờ lên các trang PDF — chọn cỡ, góc nghiêng, màu và độ mờ, xem thử trang 1 trước khi chạy. Chạy hoàn toàn trong trình duyệt.',
    es: 'Estampa texto o un logotipo sobre las páginas de un PDF: tamaño, ángulo, color y opacidad, con vista previa de la página 1. Se ejecuta en tu navegador.',
    pt: 'Aplique texto ou um logótipo sobre as páginas de um PDF: tamanho, ângulo, cor e opacidade, com pré-visualização da página 1. Roda no seu navegador.',
  },
  keywords: [
    'watermark pdf',
    'add watermark to pdf',
    'stamp pdf confidential',
    'pdf watermark offline',
    'watermark pdf without uploading',
    'add logo to pdf pages',
    'draft stamp pdf',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'add-page-numbers',
      reason: {
        en: 'Number the pages of the same document',
        vi: 'Đánh số trang cho chính tài liệu này',
        es: 'Numerar las páginas del mismo documento',
        pt: 'Numerar as páginas do mesmo documento',
      },
    },
    {
      tool: 'merge-pdf',
      reason: {
        en: 'Combine the documents first, then stamp them in one pass',
        vi: 'Gộp tài liệu trước rồi đóng dấu một lần',
        es: 'Combinar primero y estampar de una vez',
        pt: 'Juntar primeiro e marcar de uma só vez',
      },
    },
    {
      tool: 'image-to-pdf',
      reason: {
        en: 'Turn photos into a PDF you can then stamp',
        vi: 'Biến ảnh thành PDF rồi đóng dấu',
        es: 'Convertir fotos en un PDF y luego estamparlo',
        pt: 'Transformar fotos num PDF e depois marcá-lo',
      },
    },
  ],
};
