import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Hex Encode / Decode',
  toHex: 'Text → Hex',
  fromHex: 'Hex → Text',
  separator: 'Separator',
  bytePrefix: 'Byte prefix',
  pasteHex: 'Paste hex (spaces, 0x prefix, mixed case all OK)',
  error_notHexDigit: '"{char}" is not a hex digit — expected 0-9 and a-f',
  error_hexOddLength: 'Hex string has odd length',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Mã hóa / Giải mã Hex',
    toHex: 'Văn bản → Hex',
    fromHex: 'Hex → Văn bản',
    separator: 'Ký tự ngăn cách',
    bytePrefix: 'Tiền tố byte',
    pasteHex: 'Dán chuỗi hex (chấp nhận khoảng trắng, tiền tố 0x, hoa/thường)',
    error_notHexDigit: '"{char}" không phải chữ số hex — chỉ chấp nhận 0-9 và a-f',
    error_hexOddLength: 'Chuỗi hex có số ký tự lẻ',
  },
  es: {
    title: 'Codificar / Decodificar hex',
    toHex: 'Texto → Hex',
    fromHex: 'Hex → Texto',
    separator: 'Separador',
    bytePrefix: 'Prefijo de byte',
    pasteHex: 'Pega hex (espacios, prefijo 0x y mayúsculas/minúsculas admitidos)',
    error_notHexDigit: '"{char}" no es un dígito hex: se esperaba 0-9 y a-f',
    error_hexOddLength: 'La cadena hex tiene longitud impar',
  },
  pt: {
    title: 'Codificar / Decodificar hex',
    toHex: 'Texto → Hex',
    fromHex: 'Hex → Texto',
    separator: 'Separador',
    bytePrefix: 'Prefixo de byte',
    pasteHex: 'Cole hex (espaços, prefixo 0x e maiúsculas/minúsculas aceitos)',
    error_notHexDigit: '"{char}" não é um dígito hex — esperado 0-9 e a-f',
    error_hexOddLength: 'A cadeia hex tem comprimento ímpar',
  },
};
