import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'URL Encoder / Decoder',
  encodeComponent: 'Encode component',
  encodeFull: 'Encode full URL',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Mã hóa / Giải mã URL',
    encodeComponent: 'Mã hóa thành phần',
    encodeFull: 'Mã hóa cả URL',
  },
  es: {
    title: 'Codificador / Decodificador de URL',
    encodeComponent: 'Codificar componente',
    encodeFull: 'Codificar URL completa',
  },
  pt: {
    title: 'Codificador / Decodificador de URL',
    encodeComponent: 'Codificar componente',
    encodeFull: 'Codificar URL completa',
  },
};
