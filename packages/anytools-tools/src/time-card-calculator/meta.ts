import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'time-card-calculator',
  cluster: 'lifestyle',
  title: {
    en: 'Time Card Calculator',
    vi: 'Calculator chấm công',
    es: 'Calculadora de tarjeta de tiempo',
    pt: 'Calculadora de cartão de ponto',
  },
  description: {
    en: 'Sum daily work hours from clock-in/clock-out times, subtract unpaid breaks. Weekly total + pay.',
    vi: 'Tổng giờ làm hàng ngày từ giờ vào/ra, trừ break không lương. Total tuần + lương.',
    es: 'Suma horas diarias desde entrada/salida, resta descansos. Total semanal + pago.',
    pt: 'Soma horas diárias de entrada/saída, subtrai pausas. Total semanal + pagamento.',
  },
  keywords: ['time card', 'payroll', 'work hours', 'chấm công', 'tarjeta de tiempo'],
  priority: 'P3',
  effort: 'M',
  published: true,
};
