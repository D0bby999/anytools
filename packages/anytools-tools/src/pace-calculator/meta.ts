import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'pace-calculator',
  cluster: 'health',
  title: {
    en: 'Running Pace Calculator',
    vi: 'Tính pace chạy bộ',
    es: 'Calculadora de ritmo de carrera',
    pt: 'Calculadora de ritmo de corrida',
  },
  description: {
    en: 'Compute pace from distance + time, or predict time from pace + distance. Min/km, min/mile, common race distances.',
    vi: 'Tính pace từ distance + time, hoặc dự đoán time từ pace + distance. Min/km, min/mile, race distance phổ biến.',
    es: 'Calcula ritmo desde distancia + tiempo, o predice tiempo desde ritmo + distancia.',
    pt: 'Calcule ritmo a partir de distância + tempo, ou preveja tempo a partir de ritmo + distância.',
  },
  keywords: [
    'running pace',
    'pace calculator',
    'race time',
    'marathon pace',
    'half marathon',
    'pace chạy bộ',
  ],
  priority: 'P2',
  effort: 'S',
  published: true,
};
