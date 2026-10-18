import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'date-diff',
  cluster: 'lifestyle',
  title: {
    en: 'Date Difference Calculator',
    vi: 'Tính khoảng cách ngày',
    es: 'Calculadora de diferencia entre fechas',
    pt: 'Calculadora de diferença entre datas',
  },
  description: {
    en: 'Calculate years, months, days, weeks between two dates. Handles leap years and short months correctly.',
    vi: 'Tính số năm, tháng, ngày, tuần giữa hai ngày. Xử lý leap year và tháng ngắn đúng.',
    es: 'Calcula años, meses, días, semanas entre dos fechas. Maneja años bisiestos correctamente.',
    pt: 'Calcule anos, meses, dias, semanas entre duas datas. Lida com anos bissextos corretamente.',
  },
  keywords: [
    'date diff',
    'date difference',
    'days between dates',
    'tính khoảng cách ngày',
    'diferencia de fechas',
  ],
  priority: 'P2',
  effort: 'S',
  published: true,
};
