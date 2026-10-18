import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'discount-calculator',
  cluster: 'finance',
  title: {
    en: 'Discount Calculator',
    vi: 'Tính giảm giá',
    es: 'Calculadora de descuento',
    pt: 'Calculadora de desconto',
  },
  description: {
    en: 'Original price + discount % → final price + amount saved. Optionally stack a sales tax.',
    vi: 'Giá gốc + % giảm → giá cuối + số tiền tiết kiệm. Tùy chọn cộng thêm thuế.',
    es: 'Precio original + % descuento → precio final + ahorrado. Opcional sumar impuesto.',
    pt: 'Preço original + % desconto → preço final + economia. Opcional somar imposto.',
  },
  keywords: [
    'discount calculator',
    'percent off',
    'sale price',
    'tính giảm giá',
    'descuento porcentaje',
  ],
  priority: 'P2',
  effort: 'S',
  published: true,
};
