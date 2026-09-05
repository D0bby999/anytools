import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Roman Numeral Converter',
  // {max} is the largest supported number.
  numberToRoman: 'Number → Roman (1–{max})',
  romanToNumber: 'Roman → Number',
  note: 'Only standard notation is accepted. IIII and IM are readable and both are invalid — the converter says so and suggests the correct form.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Chuyển đổi số La Mã',
    numberToRoman: 'Số → La Mã (1–{max})',
    romanToNumber: 'La Mã → Số',
    note: 'Chỉ chấp nhận cách viết chuẩn. IIII và IM đọc được nhưng đều không hợp lệ — công cụ sẽ báo và gợi ý dạng đúng.',
  },
  es: {
    title: 'Conversor de números romanos',
    numberToRoman: 'Número → Romano (1–{max})',
    romanToNumber: 'Romano → Número',
    note: 'Solo se acepta la notación estándar. IIII e IM se pueden leer, pero ambos son inválidos — el conversor lo indica y sugiere la forma correcta.',
  },
  pt: {
    title: 'Conversor de algarismos romanos',
    numberToRoman: 'Número → Romano (1–{max})',
    romanToNumber: 'Romano → Número',
    note: 'Somente a notação padrão é aceita. IIII e IM são legíveis, mas ambos são inválidos — o conversor avisa e sugere a forma correta.',
  },
};
