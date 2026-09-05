import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Roman Numeral Converter',
  // {max} is the largest supported number.
  numberToRoman: 'Number → Roman (1–{max})',
  romanToNumber: 'Roman → Number',
  note: 'Only standard notation is accepted. IIII and IM are readable and both are invalid — the converter says so and suggests the correct form.',
  error_notInteger: 'Roman numerals represent whole numbers only.',
  // {min}/{max} are the supported range.
  error_outOfRange:
    'Standard Roman numerals cover {min} to {max}. There is no symbol above M, so larger numbers need overlines this tool does not produce.',
  error_empty: 'Enter a Roman numeral.',
  error_badSymbol: '"{char}" is not a Roman numeral symbol.',
  error_notStandard: '"{input}" is not valid standard notation.',
  // {suggestion} is the correct numeral, {value} its number.
  error_notStandardSuggest:
    '"{input}" is not valid standard notation. Did you mean {suggestion} ({value})?',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Chuyển đổi số La Mã',
    numberToRoman: 'Số → La Mã (1–{max})',
    romanToNumber: 'La Mã → Số',
    note: 'Chỉ chấp nhận cách viết chuẩn. IIII và IM đọc được nhưng đều không hợp lệ — công cụ sẽ báo và gợi ý dạng đúng.',
    error_notInteger: 'Số La Mã chỉ biểu diễn số nguyên.',
    error_outOfRange:
      'Số La Mã chuẩn chỉ bao phủ từ {min} đến {max}. Không có ký hiệu nào lớn hơn M, nên số lớn hơn cần gạch trên mà công cụ này không tạo ra.',
    error_empty: 'Nhập một số La Mã.',
    error_badSymbol: '"{char}" không phải ký hiệu số La Mã.',
    error_notStandard: '"{input}" không phải cách viết chuẩn.',
    error_notStandardSuggest:
      '"{input}" không phải cách viết chuẩn. Có phải bạn muốn {suggestion} ({value})?',
  },
  es: {
    title: 'Conversor de números romanos',
    numberToRoman: 'Número → Romano (1–{max})',
    romanToNumber: 'Romano → Número',
    note: 'Solo se acepta la notación estándar. IIII e IM se pueden leer, pero ambos son inválidos — el conversor lo indica y sugiere la forma correcta.',
    error_notInteger: 'Los números romanos solo representan números enteros.',
    error_outOfRange:
      'Los números romanos estándar cubren de {min} a {max}. No hay símbolo por encima de M, así que los números mayores necesitan líneas superiores que esta herramienta no produce.',
    error_empty: 'Introduce un número romano.',
    error_badSymbol: '"{char}" no es un símbolo de número romano.',
    error_notStandard: '"{input}" no es notación estándar válida.',
    error_notStandardSuggest:
      '"{input}" no es notación estándar válida. ¿Querías decir {suggestion} ({value})?',
  },
  pt: {
    title: 'Conversor de algarismos romanos',
    numberToRoman: 'Número → Romano (1–{max})',
    romanToNumber: 'Romano → Número',
    note: 'Somente a notação padrão é aceita. IIII e IM são legíveis, mas ambos são inválidos — o conversor avisa e sugere a forma correta.',
    error_notInteger: 'Algarismos romanos representam apenas números inteiros.',
    error_outOfRange:
      'Os algarismos romanos padrão cobrem de {min} a {max}. Não há símbolo acima de M, então números maiores precisam de barras superiores que esta ferramenta não produz.',
    error_empty: 'Digite um algarismo romano.',
    error_badSymbol: '"{char}" não é um símbolo de algarismo romano.',
    error_notStandard: '"{input}" não é notação padrão válida.',
    error_notStandardSuggest:
      '"{input}" não é notação padrão válida. Você quis dizer {suggestion} ({value})?',
  },
};
