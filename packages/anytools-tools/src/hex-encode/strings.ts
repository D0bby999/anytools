import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Hex Encode / Decode',
  toHex: 'Text → Hex',
  fromHex: 'Hex → Text',
  separator: 'Separator',
  bytePrefix: 'Byte prefix',
  pasteHex: 'Paste hex (spaces, 0x prefix, mixed case all OK)',
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
  },
  es: {
    title: 'Codificar / Decodificar hex',
    toHex: 'Texto → Hex',
    fromHex: 'Hex → Texto',
    separator: 'Separador',
    bytePrefix: 'Prefijo de byte',
    pasteHex: 'Pega hex (espacios, prefijo 0x y mayúsculas/minúsculas admitidos)',
  },
  pt: {
    title: 'Codificar / Decodificar hex',
    toHex: 'Texto → Hex',
    fromHex: 'Hex → Texto',
    separator: 'Separador',
    bytePrefix: 'Prefixo de byte',
    pasteHex: 'Cole hex (espaços, prefixo 0x e maiúsculas/minúsculas aceitos)',
  },
};
