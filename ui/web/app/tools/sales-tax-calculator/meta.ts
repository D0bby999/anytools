import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'sales-tax-calculator',
  cluster: 'finance',
  title: {
    en: 'Sales Tax Calculator',
    vi: 'Tính thuế bán hàng',
    es: 'Calculadora de impuesto sobre ventas',
    pt: 'Calculadora de imposto sobre vendas',
  },
  description: {
    en: 'Add or remove sales tax from a price. Configurable rate. No tax tables — bring your own rate.',
    vi: 'Cộng hoặc trừ thuế VAT/sales tax từ giá. Rate tùy chỉnh. Không cần tax table.',
    es: 'Suma o resta impuesto de un precio. Tasa configurable. Sin tablas de impuestos.',
    pt: 'Soma ou subtrai imposto de um preço. Taxa configurável. Sem tabelas de imposto.',
  },
  keywords: ['sales tax calculator', 'vat calculator', 'tính thuế', 'impuesto ventas', 'iva'],
  priority: 'P3',
  effort: 'S',
  published: true,
};
