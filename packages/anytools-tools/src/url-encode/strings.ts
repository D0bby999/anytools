import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'URL Encoder / Decoder',
  encodeComponent: 'Encode component',
  encodeFull: 'Encode full URL',
  plusAsSpace: 'Treat + as space (form / query-string data)',
  error_malformedEscape: 'Invalid URL-encoded input (malformed % escape)',
  error_invalidQuerySegment: 'Invalid query string segment: {segment}',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Mã hóa / Giải mã URL',
    encodeComponent: 'Mã hóa thành phần',
    encodeFull: 'Mã hóa cả URL',
    plusAsSpace: 'Coi + là khoảng trắng (dữ liệu form / query string)',
    error_malformedEscape: 'Chuỗi mã hóa URL không hợp lệ (escape % sai)',
    error_invalidQuerySegment: 'Đoạn query string không hợp lệ: {segment}',
  },
  es: {
    title: 'Codificador / Decodificador de URL',
    encodeComponent: 'Codificar componente',
    encodeFull: 'Codificar URL completa',
    plusAsSpace: 'Tratar + como espacio (datos de formulario / query string)',
    error_malformedEscape: 'Entrada codificada en URL no válida (escape % malformado)',
    error_invalidQuerySegment: 'Segmento de query string no válido: {segment}',
  },
  pt: {
    title: 'Codificador / Decodificador de URL',
    encodeComponent: 'Codificar componente',
    encodeFull: 'Codificar URL completa',
    plusAsSpace: 'Tratar + como espaço (dados de formulário / query string)',
    error_malformedEscape: 'Entrada codificada em URL inválida (escape % malformado)',
    error_invalidQuerySegment: 'Segmento de query string inválido: {segment}',
  },
};
