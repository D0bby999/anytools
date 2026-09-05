import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Extract Images from PDF',
  dropLabel: 'PDF to take images from',
  failed: 'Extraction failed',
  scanning: 'Scanning…',
  extract: 'Extract images',
  pageOf: 'Page {n} of {total}',
  noImages:
    'No embedded images found. If this is a text PDF that is expected — try PDF to PNG to render the pages as pictures instead.',
  downloadAllZip: 'Download all {n} as .zip',
  extractedAlt: 'Extracted from page {n}',
  downloadLink: 'download',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Trích xuất ảnh từ PDF',
    dropLabel: 'PDF cần lấy ảnh',
    failed: 'Trích xuất thất bại',
    scanning: 'Đang quét…',
    extract: 'Trích xuất ảnh',
    pageOf: 'Trang {n}/{total}',
    noImages:
      'Không tìm thấy ảnh nhúng. Nếu đây là PDF văn bản thì điều đó bình thường — hãy thử PDF sang PNG để kết xuất các trang thành ảnh.',
    downloadAllZip: 'Tải tất cả {n} ảnh dạng .zip',
    extractedAlt: 'Trích từ trang {n}',
    downloadLink: 'tải xuống',
  },
  es: {
    title: 'Extraer imágenes de un PDF',
    dropLabel: 'PDF del que extraer imágenes',
    failed: 'La extracción falló',
    scanning: 'Analizando…',
    extract: 'Extraer imágenes',
    pageOf: 'Página {n} de {total}',
    noImages:
      'No se encontraron imágenes incrustadas. Si es un PDF de texto es lo esperado — prueba PDF a PNG para renderizar las páginas como imágenes.',
    downloadAllZip: 'Descargar las {n} como .zip',
    extractedAlt: 'Extraída de la página {n}',
    downloadLink: 'descargar',
  },
  pt: {
    title: 'Extrair imagens de PDF',
    dropLabel: 'PDF de onde extrair as imagens',
    failed: 'A extração falhou',
    scanning: 'Analisando…',
    extract: 'Extrair imagens',
    pageOf: 'Página {n} de {total}',
    noImages:
      'Nenhuma imagem incorporada encontrada. Se for um PDF de texto, isso é esperado — experimente PDF para PNG para renderizar as páginas como imagens.',
    downloadAllZip: 'Baixar todas as {n} como .zip',
    extractedAlt: 'Extraída da página {n}',
    downloadLink: 'baixar',
  },
};
