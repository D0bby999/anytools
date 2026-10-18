import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'retirement-calculator',
  cluster: 'finance',
  title: {
    en: 'Retirement Calculator',
    vi: 'Tính lương hưu',
    es: 'Calculadora de jubilación',
    pt: 'Calculadora de aposentadoria',
  },
  description: {
    en: 'Project retirement balance from current savings, monthly contribution, return rate, and retirement age.',
    vi: 'Dự đoán số dư hưu trí từ saving hiện tại, đóng góp hàng tháng, return rate, tuổi nghỉ hưu.',
    es: 'Proyecta el saldo de jubilación a partir de ahorros, aportes mensuales, retorno y edad.',
    pt: 'Projete o saldo de aposentadoria a partir de poupança, aportes, retorno e idade.',
  },
  keywords: ['retirement calculator', '401k projection', 'nest egg', 'hưu trí', 'jubilación'],
  priority: 'P3',
  effort: 'M',
  published: true,
};
