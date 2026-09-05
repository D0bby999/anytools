import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'GPA Calculator',
  description: 'US 4.0 scale, weighted by credit hours.',
  courseNamePlaceholder: 'Course name (optional)',
  courseName: 'Course name',
  grade: 'Grade',
  credits: 'Credits',
  removeCourse: 'Remove course',
  addCourse: '+ Add course',
  cumulativeGpa: 'Cumulative GPA',
  caption: '{credits} credit hours across {n} courses',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Tính GPA',
    description: 'Thang 4.0 của Mỹ, tính theo trọng số tín chỉ.',
    courseNamePlaceholder: 'Tên môn học (không bắt buộc)',
    courseName: 'Tên môn học',
    grade: 'Điểm chữ',
    credits: 'Tín chỉ',
    removeCourse: 'Xóa môn học',
    addCourse: '+ Thêm môn học',
    cumulativeGpa: 'GPA tích lũy',
    caption: '{credits} tín chỉ trong {n} môn học',
  },
  es: {
    title: 'Calculadora de GPA',
    description: 'Escala 4.0 de EE. UU., ponderada por créditos.',
    courseNamePlaceholder: 'Nombre del curso (opcional)',
    courseName: 'Nombre del curso',
    grade: 'Calificación',
    credits: 'Créditos',
    removeCourse: 'Quitar curso',
    addCourse: '+ Añadir curso',
    cumulativeGpa: 'GPA acumulado',
    caption: '{credits} créditos en {n} cursos',
  },
  pt: {
    title: 'Calculadora de GPA',
    description: 'Escala 4.0 dos EUA, ponderada por créditos.',
    courseNamePlaceholder: 'Nome da disciplina (opcional)',
    courseName: 'Nome da disciplina',
    grade: 'Nota',
    credits: 'Créditos',
    removeCourse: 'Remover disciplina',
    addCourse: '+ Adicionar disciplina',
    cumulativeGpa: 'GPA acumulado',
    caption: '{credits} créditos em {n} disciplinas',
  },
};
