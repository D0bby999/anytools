import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'SQL Formatter',
  dialect: 'Dialect',
  keywords: 'Keywords',
  upper: 'UPPERCASE',
  lower: 'lowercase',
  preserve: 'preserve',
  pasteSql: 'Paste SQL here',
  outputPlaceholder: 'Formatted SQL will appear here…',
  note: 'Formats syntax — does not execute SQL. Choose the dialect that matches your database for best results.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Định dạng SQL',
    dialect: 'Phương ngữ',
    keywords: 'Từ khóa',
    upper: 'CHỮ HOA',
    lower: 'chữ thường',
    preserve: 'giữ nguyên',
    pasteSql: 'Dán SQL vào đây',
    outputPlaceholder: 'SQL đã định dạng sẽ hiện ở đây…',
    note: 'Chỉ định dạng cú pháp — không chạy SQL. Chọn đúng phương ngữ của cơ sở dữ liệu để có kết quả tốt nhất.',
  },
  es: {
    title: 'Formateador SQL',
    dialect: 'Dialecto',
    keywords: 'Palabras clave',
    upper: 'MAYÚSCULAS',
    lower: 'minúsculas',
    preserve: 'conservar',
    pasteSql: 'Pega SQL aquí',
    outputPlaceholder: 'El SQL formateado aparecerá aquí…',
    note: 'Solo formatea la sintaxis, no ejecuta SQL. Elige el dialecto de tu base de datos para mejores resultados.',
  },
  pt: {
    title: 'Formatador SQL',
    dialect: 'Dialeto',
    keywords: 'Palavras-chave',
    upper: 'MAIÚSCULAS',
    lower: 'minúsculas',
    preserve: 'preservar',
    pasteSql: 'Cole o SQL aqui',
    outputPlaceholder: 'O SQL formatado aparecerá aqui…',
    note: 'Só formata a sintaxe — não executa SQL. Escolha o dialeto do seu banco de dados para melhores resultados.',
  },
};
