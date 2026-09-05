import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Markdown ↔ HTML Converter',
  gfm: 'GitHub Flavored Markdown (tables, task lists, strikethrough)',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Chuyển đổi Markdown ↔ HTML',
    gfm: 'GitHub Flavored Markdown (bảng, danh sách việc, gạch ngang)',
  },
  es: {
    title: 'Conversor Markdown ↔ HTML',
    gfm: 'GitHub Flavored Markdown (tablas, listas de tareas, tachado)',
  },
  pt: {
    title: 'Conversor Markdown ↔ HTML',
    gfm: 'GitHub Flavored Markdown (tabelas, listas de tarefas, tachado)',
  },
};
