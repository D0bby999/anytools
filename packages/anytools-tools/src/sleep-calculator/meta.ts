import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'sleep-calculator',
  cluster: 'health',
  title: {
    en: 'Sleep Calculator',
    vi: 'Tính giờ ngủ',
    es: 'Calculadora de sueño',
    pt: 'Calculadora de sono',
  },
  description: {
    en: 'Optimal bedtimes for waking refreshed. Based on 90-minute REM cycles + 14-minute fall-asleep average.',
    vi: 'Giờ ngủ tối ưu để dậy tỉnh táo. Dựa trên chu kỳ REM 90 phút + 14 phút trung bình để ngủ.',
    es: 'Horas óptimas para acostarse y despertar descansado. Basado en ciclos REM de 90 min.',
    pt: 'Horários ótimos para deitar e acordar descansado. Baseado em ciclos REM de 90 min.',
  },
  keywords: [
    'sleep calculator',
    'rem cycle',
    'bedtime calculator',
    'tính giờ ngủ',
    'calculadora de sueño',
  ],
  priority: 'P2',
  effort: 'S',
  published: true,
};
