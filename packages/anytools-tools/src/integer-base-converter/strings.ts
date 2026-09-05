import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Integer Base Converter',
  number: 'Number',
  inputBase: 'Input base',
  base: 'Base',
  binary: 'Binary',
  octal: 'Octal',
  decimal: 'Decimal',
  hex: 'Hex',
  // {code} marks where the inline <code>parseInt</code> goes.
  precisionNote:
    'Values are parsed as arbitrary-precision integers, so numbers above 2^53 stay exact — {code} would round them.',
  error_baseRange: 'Base must be between {min} and {max}.',
  error_enterNumber: 'Enter a number.',
  error_invalidDigit: '"{char}" is not a valid digit in base {base}. Allowed: {allowed}',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Chuyển đổi hệ cơ số',
    number: 'Số',
    inputBase: 'Hệ cơ số đầu vào',
    base: 'Cơ số',
    binary: 'Nhị phân',
    octal: 'Bát phân',
    decimal: 'Thập phân',
    hex: 'Thập lục phân',
    precisionNote:
      'Giá trị được phân tích dưới dạng số nguyên độ chính xác tùy ý, nên số lớn hơn 2^53 vẫn chính xác — {code} sẽ làm tròn chúng.',
    error_baseRange: 'Cơ số phải từ {min} đến {max}.',
    error_enterNumber: 'Hãy nhập một số.',
    error_invalidDigit:
      '"{char}" không phải chữ số hợp lệ trong hệ cơ số {base}. Cho phép: {allowed}',
  },
  es: {
    title: 'Conversor de bases numéricas',
    number: 'Número',
    inputBase: 'Base de entrada',
    base: 'Base',
    binary: 'Binario',
    octal: 'Octal',
    decimal: 'Decimal',
    hex: 'Hexadecimal',
    precisionNote:
      'Los valores se analizan como enteros de precisión arbitraria, así que los números mayores que 2^53 se mantienen exactos — {code} los redondearía.',
    error_baseRange: 'La base debe estar entre {min} y {max}.',
    error_enterNumber: 'Introduce un número.',
    error_invalidDigit: '"{char}" no es un dígito válido en base {base}. Permitidos: {allowed}',
  },
  pt: {
    title: 'Conversor de bases numéricas',
    number: 'Número',
    inputBase: 'Base de entrada',
    base: 'Base',
    binary: 'Binário',
    octal: 'Octal',
    decimal: 'Decimal',
    hex: 'Hexadecimal',
    precisionNote:
      'Os valores são interpretados como inteiros de precisão arbitrária, então números acima de 2^53 permanecem exatos — {code} os arredondaria.',
    error_baseRange: 'A base deve estar entre {min} e {max}.',
    error_enterNumber: 'Digite um número.',
    error_invalidDigit: '"{char}" não é um dígito válido na base {base}. Permitidos: {allowed}',
  },
};
