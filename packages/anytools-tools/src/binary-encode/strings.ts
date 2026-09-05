import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Binary Encode / Decode',
  toBinary: 'Text → Binary',
  fromBinary: 'Binary → Text',
  byteSeparator: 'Byte separator',
  separatorPlaceholder: '(empty for no separator)',
  pasteBinary: 'Paste 8-bit binary (spaces optional)',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Mã hóa / Giải mã nhị phân',
    toBinary: 'Văn bản → Nhị phân',
    fromBinary: 'Nhị phân → Văn bản',
    byteSeparator: 'Ký tự ngăn cách byte',
    separatorPlaceholder: '(để trống nếu không ngăn cách)',
    pasteBinary: 'Dán chuỗi nhị phân 8-bit (có thể có khoảng trắng)',
  },
  es: {
    title: 'Codificar / Decodificar binario',
    toBinary: 'Texto → Binario',
    fromBinary: 'Binario → Texto',
    byteSeparator: 'Separador de bytes',
    separatorPlaceholder: '(vacío para no separar)',
    pasteBinary: 'Pega binario de 8 bits (espacios opcionales)',
  },
  pt: {
    title: 'Codificar / Decodificar binário',
    toBinary: 'Texto → Binário',
    fromBinary: 'Binário → Texto',
    byteSeparator: 'Separador de bytes',
    separatorPlaceholder: '(vazio para não separar)',
    pasteBinary: 'Cole binário de 8 bits (espaços opcionais)',
  },
};
