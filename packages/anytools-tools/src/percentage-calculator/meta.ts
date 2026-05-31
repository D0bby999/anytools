import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'percentage-calculator',
  cluster: 'lifestyle',
  title: {
    en: 'Percentage Calculator',
    vi: 'Tính phần trăm',
    es: 'Calculadora de porcentaje',
    pt: 'Calculadora de porcentagem',
  },
  description: {
    en: 'Three modes: X% of Y, X is what % of Y, % change from X to Y. Discounts, taxes, grades, growth rates.',
    vi: 'Ba chế độ: X% của Y, X là bao nhiêu % của Y, % thay đổi từ X sang Y. Discount, thuế, điểm, tăng trưởng.',
    es: 'Tres modos: X% de Y, X es qué % de Y, % de cambio. Descuentos, impuestos, notas, crecimiento.',
    pt: 'Três modos: X% de Y, X é que % de Y, % de mudança. Descontos, impostos, notas, crescimento.',
  },
  keywords: ['percentage', 'percent', 'discount', 'percent change', 'percent of', 'tính phần trăm'],
  priority: 'P1',
  effort: 'S',
  published: true,
};
