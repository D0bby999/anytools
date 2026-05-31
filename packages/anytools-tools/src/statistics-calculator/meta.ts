import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'statistics-calculator',
  cluster: 'lifestyle',
  title: {
    en: 'Statistics Calculator — Mean, Median, Std Dev',
    vi: 'Calculator Thống kê — Trung bình, trung vị, độ lệch chuẩn',
    es: 'Calculadora de estadísticas — Media, mediana, desviación',
    pt: 'Calculadora de estatísticas — Média, mediana, desvio',
  },
  description: {
    en: 'Paste a list of numbers, get mean, median, mode, range, variance, standard deviation, quartiles.',
    vi: 'Paste list số, lấy mean, median, mode, range, variance, std dev, quartile.',
    es: 'Pega lista de números, obtén media, mediana, moda, rango, varianza, desviación, cuartiles.',
    pt: 'Cole lista de números, obtenha média, mediana, moda, intervalo, variância, desvio, quartis.',
  },
  keywords: [
    'statistics calculator',
    'standard deviation',
    'mean median mode',
    'variance',
    'quartile',
  ],
  priority: 'P2',
  effort: 'S',
  published: true,
};
