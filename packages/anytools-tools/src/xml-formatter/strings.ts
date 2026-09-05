import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'XML Formatter / Validator',
  minifyOn: 'Minify ON',
  minifyOff: 'Minify OFF',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Định dạng / Kiểm tra XML',
    minifyOn: 'Rút gọn: BẬT',
    minifyOff: 'Rút gọn: TẮT',
  },
  es: {
    title: 'Formateador / Validador XML',
    minifyOn: 'Minificar: SÍ',
    minifyOff: 'Minificar: NO',
  },
  pt: {
    title: 'Formatador / Validador XML',
    minifyOn: 'Minificar: SIM',
    minifyOff: 'Minificar: NÃO',
  },
};
