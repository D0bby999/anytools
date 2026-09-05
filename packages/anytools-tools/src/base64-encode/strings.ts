import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Base64',
  urlSafe: 'URL-safe (RFC 4648 §5)',
  plainInput: 'Plain text input',
  base64Input: 'Base64 input',
  error_invalidBase64: 'Invalid Base64 input',
  error_invalidBase64Url: 'Invalid Base64URL input',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    urlSafe: 'An toàn cho URL (RFC 4648 §5)',
    plainInput: 'Văn bản gốc',
    base64Input: 'Chuỗi Base64',
    error_invalidBase64: 'Chuỗi Base64 không hợp lệ',
    error_invalidBase64Url: 'Chuỗi Base64URL không hợp lệ',
  },
  es: {
    urlSafe: 'Seguro para URL (RFC 4648 §5)',
    plainInput: 'Texto sin formato',
    base64Input: 'Entrada Base64',
    error_invalidBase64: 'Entrada Base64 no válida',
    error_invalidBase64Url: 'Entrada Base64URL no válida',
  },
  pt: {
    urlSafe: 'Seguro para URL (RFC 4648 §5)',
    plainInput: 'Texto simples',
    base64Input: 'Entrada Base64',
    error_invalidBase64: 'Entrada Base64 inválida',
    error_invalidBase64Url: 'Entrada Base64URL inválida',
  },
};
