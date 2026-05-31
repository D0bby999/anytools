import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'loan-calculator',
  cluster: 'finance',
  title: {
    en: 'Loan Calculator',
    vi: 'Tính vay',
    es: 'Calculadora de préstamo',
    pt: 'Calculadora de empréstimo',
  },
  description: {
    en: 'Monthly payment + interest for auto, personal, student loans. Amortization preview.',
    vi: 'Trả góp + lãi cho vay auto, cá nhân, student. Preview amortization.',
    es: 'Pago mensual + interés para préstamo de auto, personal, estudiantil. Vista de amortización.',
    pt: 'Pagamento mensal + juros para empréstimo auto, pessoal, estudantil. Prévia de amortização.',
  },
  keywords: ['loan calculator', 'auto loan', 'personal loan', 'student loan', 'tính vay'],
  priority: 'P2',
  effort: 'S',
  published: true,
};
