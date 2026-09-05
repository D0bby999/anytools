import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'grade-calculator',
  cluster: 'lifestyle',
  title: {
    en: 'Final Grade Calculator',
    vi: 'Tính điểm thi cuối kỳ cần đạt',
    es: 'Calculadora de nota final',
    pt: 'Calculadora de nota final',
  },
  description: {
    en: 'What do I need on the final? Given current grade + final weight + target grade, calculate the required score.',
    vi: 'Cần bao nhiêu điểm ở bài cuối kỳ? Nhập điểm hiện tại, trọng số bài cuối và điểm mục tiêu để tính điểm cần đạt.',
    es: '¿Qué nota necesito en el final? Con tu nota actual, el peso del examen final y la nota objetivo, calcula la puntuación necesaria.',
    pt: 'Que nota preciso na prova final? Com a nota atual, o peso da prova final e a nota desejada, calcula a pontuação necessária.',
  },
  keywords: ['grade calculator', 'final grade needed', 'what do i need on the final', 'gpa target'],
  priority: 'P3',
  effort: 'S',
  published: true,
  availableLocales: ['en'],
};
