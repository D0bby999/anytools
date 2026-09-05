import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'HTML Entity Encoder / Decoder',
  encodeNonAscii: 'Also encode non-ASCII (é → &eacute;)',
  encodeEverything: 'Encode every character (not just required)',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Mã hóa / Giải mã HTML Entity',
    encodeNonAscii: 'Mã hóa cả ký tự ngoài ASCII (é → &eacute;)',
    encodeEverything: 'Mã hóa mọi ký tự (không chỉ ký tự bắt buộc)',
  },
  es: {
    title: 'Codificador / Decodificador de entidades HTML',
    encodeNonAscii: 'Codificar también no-ASCII (é → &eacute;)',
    encodeEverything: 'Codificar todos los caracteres (no solo los obligatorios)',
  },
  pt: {
    title: 'Codificador / Decodificador de entidades HTML',
    encodeNonAscii: 'Codificar também não-ASCII (é → &eacute;)',
    encodeEverything: 'Codificar todos os caracteres (não só os obrigatórios)',
  },
};
