import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'gpa-calculator',
  cluster: 'lifestyle',
  title: {
    en: 'GPA Calculator',
    vi: 'Tính điểm GPA',
    es: 'Calculadora de GPA',
    pt: 'Calculadora de GPA',
  },
  description: {
    en: 'Calculate cumulative GPA on the US 4.0 scale. Add courses with grade and credit hours, get weighted average.',
    vi: 'Tính GPA tích lũy theo thang 4.0 của Mỹ. Thêm môn học với điểm và số tín chỉ, nhận trung bình có trọng số.',
    es: 'Calcula el GPA acumulado en la escala 4.0 de EE. UU. Añade cursos con nota y créditos y obtén la media ponderada.',
    pt: 'Calcula o GPA acumulado na escala 4.0 dos EUA. Adicione disciplinas com nota e créditos e obtenha a média ponderada.',
  },
  keywords: ['gpa', 'gpa calculator', 'grade point average', 'us 4.0 scale', 'cumulative gpa'],
  priority: 'P1',
  effort: 'S',
  published: true,
  availableLocales: ['en'],
};
