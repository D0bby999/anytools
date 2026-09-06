import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Font Converter',
  fileLabel: 'Font file (.ttf, .otf or .woff)',
  targetLabel: 'Output',
  targetNative: 'Raw font (TTF/OTF)',
  targetWoff: 'WOFF (compressed)',
  subsetLabel: 'Subset — characters to keep (leave empty to keep all of them)',
  subsetPlaceholder: 'e.g. a sentence in the language you need',
  previewLabel: 'Preview text',
  convert: 'Convert',
  converting: 'Converting…',
  download: 'Download',
  detectedFlavor: 'Detected: {flavor}',
  // {in} / {out} formatted sizes, {percent} 0-100
  summary: '{in} → {out} ({percent}% smaller)',
  summaryGrew: '{in} → {out} (larger — WOFF headers cost more than tiny fonts save)',
  subsetSummary: 'Subset to {n} character(s).',
  convertFailed: 'Could not convert this font.',
  error_woff2Unsupported:
    'This is a WOFF2 file. WOFF2 tables are Brotli-compressed, and no Brotli codec is available here — browsers do not expose one via the Compression Streams API, and none is pinned for this tool. Re-export the font as TTF, OTF or WOFF1 first.',
  error_unknownFormat:
    'This does not look like a TTF, OTF or WOFF file (the first four bytes do not match any of their signatures).',
  // {detail} the underlying parse error
  error_parseFailed: 'Could not read this font: {detail}',
  // {detail} the underlying subsetting error
  error_subsetFailed: 'Subsetting failed: {detail}',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Chuyển đổi Font',
    fileLabel: 'File font (.ttf, .otf hoặc .woff)',
    targetLabel: 'Đầu ra',
    targetNative: 'Font gốc (TTF/OTF)',
    targetWoff: 'WOFF (đã nén)',
    subsetLabel: 'Rút gọn — ký tự cần giữ (để trống để giữ tất cả)',
    subsetPlaceholder: 'vd. một câu bằng ngôn ngữ bạn cần',
    previewLabel: 'Chữ xem trước',
    convert: 'Chuyển đổi',
    converting: 'Đang chuyển đổi…',
    download: 'Tải xuống',
    detectedFlavor: 'Nhận diện: {flavor}',
    summary: '{in} → {out} (nhỏ hơn {percent}%)',
    summaryGrew: '{in} → {out} (lớn hơn — header của WOFF tốn hơn phần font nhỏ tiết kiệm được)',
    subsetSummary: 'Đã rút gọn còn {n} ký tự.',
    convertFailed: 'Không thể chuyển đổi font này.',
    error_woff2Unsupported:
      'Đây là file WOFF2. Các bảng trong WOFF2 được nén bằng Brotli, và ở đây không có bộ giải mã Brotli nào — trình duyệt không lộ API Brotli qua Compression Streams, và công cụ này cũng không ghim thư viện nào. Hãy xuất lại font sang TTF, OTF hoặc WOFF1 trước.',
    error_unknownFormat:
      'File này không giống TTF, OTF hay WOFF (4 byte đầu không khớp chữ ký của bất kỳ định dạng nào).',
    error_parseFailed: 'Không đọc được font này: {detail}',
    error_subsetFailed: 'Rút gọn thất bại: {detail}',
  },
  es: {
    title: 'Convertidor de Fuentes',
    fileLabel: 'Archivo de fuente (.ttf, .otf o .woff)',
    targetLabel: 'Salida',
    targetNative: 'Fuente sin comprimir (TTF/OTF)',
    targetWoff: 'WOFF (comprimida)',
    subsetLabel: 'Subconjunto — caracteres a conservar (vacío para conservarlos todos)',
    subsetPlaceholder: 'p. ej. una frase en el idioma que necesitas',
    previewLabel: 'Texto de vista previa',
    convert: 'Convertir',
    converting: 'Convirtiendo…',
    download: 'Descargar',
    detectedFlavor: 'Detectado: {flavor}',
    summary: '{in} → {out} ({percent}% más pequeño)',
    summaryGrew:
      '{in} → {out} (más grande — la cabecera de WOFF cuesta más de lo que ahorra en fuentes muy pequeñas)',
    subsetSummary: 'Reducido a {n} carácter(es).',
    convertFailed: 'No se pudo convertir esta fuente.',
    error_woff2Unsupported:
      'Este es un archivo WOFF2. Sus tablas están comprimidas con Brotli, y aquí no hay ningún códec Brotli disponible — los navegadores no lo exponen vía la Compression Streams API, y esta herramienta no fija ninguna librería para ello. Vuelve a exportar la fuente como TTF, OTF o WOFF1 primero.',
    error_unknownFormat:
      'Esto no parece un archivo TTF, OTF o WOFF (los primeros cuatro bytes no coinciden con ninguna de esas firmas).',
    error_parseFailed: 'No se pudo leer esta fuente: {detail}',
    error_subsetFailed: 'Falló la creación del subconjunto: {detail}',
  },
  pt: {
    title: 'Conversor de Fontes',
    fileLabel: 'Arquivo de fonte (.ttf, .otf ou .woff)',
    targetLabel: 'Saída',
    targetNative: 'Fonte bruta (TTF/OTF)',
    targetWoff: 'WOFF (compactada)',
    subsetLabel: 'Subconjunto — caracteres a manter (deixe vazio para manter todos)',
    subsetPlaceholder: 'ex.: uma frase no idioma que você precisa',
    previewLabel: 'Texto de pré-visualização',
    convert: 'Converter',
    converting: 'Convertendo…',
    download: 'Baixar',
    detectedFlavor: 'Detectado: {flavor}',
    summary: '{in} → {out} ({percent}% menor)',
    summaryGrew:
      '{in} → {out} (maior — o cabeçalho do WOFF custa mais do que fontes bem pequenas economizam)',
    subsetSummary: 'Reduzido para {n} caractere(s).',
    convertFailed: 'Não foi possível converter esta fonte.',
    error_woff2Unsupported:
      'Este é um arquivo WOFF2. As tabelas do WOFF2 são compactadas com Brotli, e não há nenhum codec Brotli disponível aqui — os navegadores não o expõem pela Compression Streams API, e esta ferramenta não fixa nenhuma biblioteca para isso. Exporte a fonte novamente como TTF, OTF ou WOFF1 antes.',
    error_unknownFormat:
      'Isso não parece um arquivo TTF, OTF ou WOFF (os primeiros quatro bytes não correspondem a nenhuma dessas assinaturas).',
    error_parseFailed: 'Não foi possível ler esta fonte: {detail}',
    error_subsetFailed: 'Falha ao gerar o subconjunto: {detail}',
  },
};
