import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Base64',
  urlSafe: 'URL-safe (RFC 4648 §5)',
  plainInput: 'Plain text input',
  base64Input: 'Base64 input',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    urlSafe: 'An toàn cho URL (RFC 4648 §5)',
    plainInput: 'Văn bản gốc',
    base64Input: 'Chuỗi Base64',
  },
  es: {
    urlSafe: 'Seguro para URL (RFC 4648 §5)',
    plainInput: 'Texto sin formato',
    base64Input: 'Entrada Base64',
  },
  pt: {
    urlSafe: 'Seguro para URL (RFC 4648 §5)',
    plainInput: 'Texto simples',
    base64Input: 'Entrada Base64',
  },
};
