import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'mortgage-calculator',
  cluster: 'finance',
  title: {
    en: 'Mortgage Calculator',
    vi: 'Tính thế chấp / vay mua nhà',
    es: 'Calculadora de hipoteca',
    pt: 'Calculadora de financiamento imobiliário',
  },
  description: {
    en: 'Monthly payment + total interest from loan amount, rate, and term. User-input rate (no live rate fetch).',
    vi: 'Trả góp hàng tháng + tổng lãi từ số tiền vay, lãi suất, và kỳ hạn. Lãi suất nhập tay.',
    es: 'Pago mensual + interés total a partir del monto, tasa y plazo. Tasa ingresada por usuario.',
    pt: 'Pagamento mensal + juros totais a partir do valor, taxa e prazo. Taxa inserida pelo usuário.',
  },
  keywords: [
    'mortgage calculator',
    'home loan',
    'monthly payment',
    'amortization',
    'tính thế chấp',
  ],
  priority: 'P2',
  effort: 'M',
  published: true,
};
