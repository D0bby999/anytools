import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Binary Encode / Decode',
  toBinary: 'Text → Binary',
  fromBinary: 'Binary → Text',
  byteSeparator: 'Byte separator',
  separatorPlaceholder: '(empty for no separator)',
  pasteBinary: 'Paste 8-bit binary (spaces optional)',
  error_notBinaryDigit: '"{char}" is not a binary digit — expected only 0 and 1',
  error_binaryLength: 'Binary string length must be a multiple of 8',
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
    error_notBinaryDigit: '"{char}" không phải chữ số nhị phân — chỉ chấp nhận 0 và 1',
    error_binaryLength: 'Độ dài chuỗi nhị phân phải là bội số của 8',
  },
  es: {
    title: 'Codificar / Decodificar binario',
    toBinary: 'Texto → Binario',
    fromBinary: 'Binario → Texto',
    byteSeparator: 'Separador de bytes',
    separatorPlaceholder: '(vacío para no separar)',
    pasteBinary: 'Pega binario de 8 bits (espacios opcionales)',
    error_notBinaryDigit: '"{char}" no es un dígito binario: solo se admiten 0 y 1',
    error_binaryLength: 'La longitud de la cadena binaria debe ser múltiplo de 8',
  },
  pt: {
    title: 'Codificar / Decodificar binário',
    toBinary: 'Texto → Binário',
    fromBinary: 'Binário → Texto',
    byteSeparator: 'Separador de bytes',
    separatorPlaceholder: '(vazio para não separar)',
    pasteBinary: 'Cole binário de 8 bits (espaços opcionais)',
    error_notBinaryDigit: '"{char}" não é um dígito binário — apenas 0 e 1',
    error_binaryLength: 'O comprimento da cadeia binária deve ser múltiplo de 8',
  },
};
