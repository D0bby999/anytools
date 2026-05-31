import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'tip-calculator',
  cluster: 'finance',
  title: {
    en: 'Tip Calculator & Bill Splitter',
    vi: 'Tính tiền tip & chia hóa đơn',
    es: 'Calculadora de propina y división de cuenta',
    pt: 'Calculadora de gorjeta e divisão de conta',
  },
  description: {
    en: 'Quick tip calculator with bill splitter. Set tip percentage, number of people, see per-person amount instantly.',
    vi: 'Tính tip nhanh và chia hóa đơn. Đặt phần trăm tip, số người, xem ngay số tiền mỗi người.',
    es: 'Calculadora rápida de propina con divisor. Configura porcentaje, número de personas, ve el monto por persona.',
    pt: 'Calculadora rápida de gorjeta com divisor. Configure porcentagem, número de pessoas, veja o valor por pessoa.',
  },
  keywords: [
    'tip calculator',
    'bill splitter',
    'split bill',
    'gratuity',
    'tính tip',
    'chia hóa đơn',
  ],
  priority: 'P1',
  effort: 'S',
  published: true,
};
