import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Text Case Converter',
  placeholder: 'Paste text to convert',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Chuyển đổi kiểu chữ',
    placeholder: 'Dán văn bản cần chuyển',
  },
  es: {
    title: 'Conversor de mayúsculas y minúsculas',
    placeholder: 'Pega el texto a convertir',
  },
  pt: {
    title: 'Conversor de caixa de texto',
    placeholder: 'Cole o texto a converter',
  },
};
