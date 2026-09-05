import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Mock Data Generator',
  fieldName: 'field name',
  fieldType: 'Field type',
  addField: '+ Add field',
  count: 'Count (1-1000)',
  locale: 'Locale',
  format: 'Format',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Tạo dữ liệu giả',
    fieldName: 'tên trường',
    fieldType: 'Kiểu trường',
    addField: '+ Thêm trường',
    count: 'Số lượng (1-1000)',
    locale: 'Ngôn ngữ',
    format: 'Định dạng',
  },
  es: {
    title: 'Generador de datos de prueba',
    fieldName: 'nombre del campo',
    fieldType: 'Tipo de campo',
    addField: '+ Añadir campo',
    count: 'Cantidad (1-1000)',
    locale: 'Idioma',
    format: 'Formato',
  },
  pt: {
    title: 'Gerador de dados fictícios',
    fieldName: 'nome do campo',
    fieldType: 'Tipo do campo',
    addField: '+ Adicionar campo',
    count: 'Quantidade (1-1000)',
    locale: 'Idioma',
    format: 'Formato',
  },
};
