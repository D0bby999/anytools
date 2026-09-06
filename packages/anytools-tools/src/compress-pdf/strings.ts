import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Compress PDF',
  dropLabel: 'PDF to compress',
  quality: 'JPEG quality: {n}%',
  qualityHint: 'Lower is smaller and blurrier. Text stays sharp; photos lose detail first.',
  maxDpi: 'Cap image resolution',
  maxDpiNone: 'No cap (quality only)',
  maxDpiValue: '{n} DPI (recommended for reading on screen)',
  compress: 'Compress',
  compressing: 'Compressing…',
  failed: 'Compression failed',
  pageCountOne: '{n} page',
  pageCountMany: '{n} pages',
  summary:
    'Recompressed {recompressed} of {total} embedded image(s); {skipped} left unchanged. {before} → {after} ({pct}).',
  smaller: '{n}% smaller',
  larger: '{n}% larger',
  aboutSame: 'about the same size',
  noImages:
    'No JPEG image in this PDF could be recompressed. This is expected for a text-only PDF, or one whose images are already small, non-JPEG, or transparency masks — see the FAQ below for the exact scope.',
  download: 'Download {name}',
  error_pdfSaveFailed:
    'Could not save the compressed PDF ({detail}). This is a bug on our side, not a problem with your file.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Nén PDF',
    dropLabel: 'PDF cần nén',
    quality: 'Chất lượng JPEG: {n}%',
    qualityHint: 'Càng thấp file càng nhỏ và càng mờ. Chữ vẫn nét; ảnh chụp mất chi tiết trước.',
    maxDpi: 'Giới hạn độ phân giải ảnh',
    maxDpiNone: 'Không giới hạn (chỉ giảm chất lượng)',
    maxDpiValue: '{n} DPI (khuyến nghị để đọc trên màn hình)',
    compress: 'Nén',
    compressing: 'Đang nén…',
    failed: 'Nén thất bại',
    pageCountOne: '{n} trang',
    pageCountMany: '{n} trang',
    summary:
      'Đã nén lại {recompressed}/{total} ảnh nhúng; {skipped} ảnh giữ nguyên. {before} → {after} ({pct}).',
    smaller: 'nhỏ hơn {n}%',
    larger: 'lớn hơn {n}%',
    aboutSame: 'gần như không đổi',
    noImages:
      'Không có ảnh JPEG nào trong PDF này nén lại được. Đây là điều bình thường với PDF toàn chữ, hoặc PDF có ảnh đã nhỏ sẵn, không phải JPEG, hay là mặt nạ trong suốt — xem FAQ bên dưới để biết đúng phạm vi tool xử lý.',
    download: 'Tải {name}',
    error_pdfSaveFailed:
      'Không lưu được PDF đã nén ({detail}). Đây là lỗi phía chúng tôi, không phải do file của bạn.',
  },
  es: {
    title: 'Comprimir PDF',
    dropLabel: 'PDF a comprimir',
    quality: 'Calidad JPEG: {n}%',
    qualityHint:
      'Cuanto más baja, más pequeño y borroso. El texto se mantiene nítido; las fotos pierden detalle primero.',
    maxDpi: 'Limitar la resolución de las imágenes',
    maxDpiNone: 'Sin límite (solo calidad)',
    maxDpiValue: '{n} DPI (recomendado para leer en pantalla)',
    compress: 'Comprimir',
    compressing: 'Comprimiendo…',
    failed: 'La compresión falló',
    pageCountOne: '{n} página',
    pageCountMany: '{n} páginas',
    summary:
      'Se recomprimieron {recompressed} de {total} imagen(es) incrustada(s); {skipped} sin cambios. {before} → {after} ({pct}).',
    smaller: '{n}% más pequeño',
    larger: '{n}% más grande',
    aboutSame: 'casi el mismo tamaño',
    noImages:
      'Ninguna imagen JPEG de este PDF se pudo recomprimir. Es normal en un PDF solo de texto, o con imágenes ya pequeñas, que no son JPEG, o que son máscaras de transparencia — ve el FAQ abajo para el alcance exacto.',
    download: 'Descargar {name}',
    error_pdfSaveFailed:
      'No se pudo guardar el PDF comprimido ({detail}). Es un fallo nuestro, no un problema de tu archivo.',
  },
  pt: {
    title: 'Comprimir PDF',
    dropLabel: 'PDF a comprimir',
    quality: 'Qualidade JPEG: {n}%',
    qualityHint:
      'Quanto mais baixa, menor e mais borrada. O texto continua nítido; as fotos perdem detalhe primeiro.',
    maxDpi: 'Limitar a resolução das imagens',
    maxDpiNone: 'Sem limite (só qualidade)',
    maxDpiValue: '{n} DPI (recomendado para ler na tela)',
    compress: 'Comprimir',
    compressing: 'Comprimindo…',
    failed: 'A compressão falhou',
    pageCountOne: '{n} página',
    pageCountMany: '{n} páginas',
    summary:
      'Recomprimidas {recompressed} de {total} imagem(ns) incorporada(s); {skipped} sem alteração. {before} → {after} ({pct}).',
    smaller: '{n}% menor',
    larger: '{n}% maior',
    aboutSame: 'quase o mesmo tamanho',
    noImages:
      'Nenhuma imagem JPEG deste PDF pôde ser recomprimida. Isso é esperado num PDF só de texto, ou com imagens já pequenas, que não são JPEG, ou que são máscaras de transparência — veja o FAQ abaixo para o escopo exato.',
    download: 'Baixar {name}',
    error_pdfSaveFailed:
      'Não foi possível salvar o PDF comprimido ({detail}). Isso é um erro nosso, não um problema com o seu arquivo.',
  },
};
