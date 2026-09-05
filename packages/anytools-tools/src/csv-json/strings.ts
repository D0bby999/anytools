import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'CSV ↔ JSON Converter',
  firstRowHeader: 'First row is header',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Chuyển đổi CSV ↔ JSON',
    firstRowHeader: 'Dòng đầu là tiêu đề',
  },
  es: {
    title: 'Conversor CSV ↔ JSON',
    firstRowHeader: 'La primera fila es el encabezado',
  },
  pt: {
    title: 'Conversor CSV ↔ JSON',
    firstRowHeader: 'A primeira linha é o cabeçalho',
  },
};
