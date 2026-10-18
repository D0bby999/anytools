import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'reading-time',
  cluster: 'lifestyle',
  title: {
    en: 'Reading Time Estimator',
    vi: 'Ước tính thời gian đọc',
    es: 'Estimador de tiempo de lectura',
    pt: 'Estimador de tempo de leitura',
  },
  description: {
    en: 'Estimate reading and speaking time from text. Adjustable WPM for different audiences.',
    vi: 'Ước tính thời gian đọc và nói từ text. WPM điều chỉnh được cho các audience khác nhau.',
    es: 'Estima el tiempo de lectura y habla desde texto. WPM ajustable para diferentes audiencias.',
    pt: 'Estime o tempo de leitura e fala a partir do texto. WPM ajustável para diferentes audiências.',
  },
  keywords: [
    'reading time',
    'wpm',
    'speaking time',
    'reading estimator',
    'thời gian đọc',
    'tiempo lectura',
  ],
  priority: 'P2',
  effort: 'S',
  published: true,
};
