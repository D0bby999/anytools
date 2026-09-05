import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'URL Encoder / Decoder',
  encodeComponent: 'Encode component',
  encodeFull: 'Encode full URL',
  plusAsSpace: 'Treat + as space (form / query-string data)',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Mã hóa / Giải mã URL',
    encodeComponent: 'Mã hóa thành phần',
    encodeFull: 'Mã hóa cả URL',
    plusAsSpace: 'Coi + là khoảng trắng (dữ liệu form / query string)',
  },
  es: {
    title: 'Codificador / Decodificador de URL',
    encodeComponent: 'Codificar componente',
    encodeFull: 'Codificar URL completa',
    plusAsSpace: 'Tratar + como espacio (datos de formulario / query string)',
  },
  pt: {
    title: 'Codificador / Decodificador de URL',
    encodeComponent: 'Codificar componente',
    encodeFull: 'Codificar URL completa',
    plusAsSpace: 'Tratar + como espaço (dados de formulário / query string)',
  },
};
