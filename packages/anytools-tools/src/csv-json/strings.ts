import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'CSV ↔ JSON Converter',
  firstRowHeader: 'First row is header',
  // {detail} is the parser's own reason, in English.
  error_csvParse: 'Could not parse the CSV: {detail}',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Chuyển đổi CSV ↔ JSON',
    firstRowHeader: 'Dòng đầu là tiêu đề',
    error_csvParse: 'Không đọc được CSV: {detail}',
  },
  es: {
    title: 'Conversor CSV ↔ JSON',
    firstRowHeader: 'La primera fila es el encabezado',
    error_csvParse: 'No se pudo analizar el CSV: {detail}',
  },
  pt: {
    title: 'Conversor CSV ↔ JSON',
    firstRowHeader: 'A primeira linha é o cabeçalho',
    error_csvParse: 'Não foi possível analisar o CSV: {detail}',
  },
};
