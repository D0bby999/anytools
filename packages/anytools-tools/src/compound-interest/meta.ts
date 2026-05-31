import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'compound-interest',
  cluster: 'finance',
  title: {
    en: 'Compound Interest Calculator',
    vi: 'Tính lãi kép',
    es: 'Calculadora de interés compuesto',
    pt: 'Calculadora de juros compostos',
  },
  description: {
    en: 'Calculate compound interest over time with monthly contributions. See final balance, total interest, total contributions.',
    vi: 'Tính lãi kép theo thời gian với đóng góp hàng tháng. Xem số dư cuối, tổng lãi, tổng đóng góp.',
    es: 'Calcula interés compuesto en el tiempo con aportes mensuales. Ve saldo final, interés total, aportes totales.',
    pt: 'Calcule juros compostos ao longo do tempo com aportes mensais. Veja saldo final, juros totais, aportes totais.',
  },
  keywords: [
    'compound interest',
    'investment growth',
    'savings calculator',
    'lãi kép',
    'interés compuesto',
  ],
  priority: 'P1',
  effort: 'S',
  published: true,
};
