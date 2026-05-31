import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'body-fat-calculator',
  cluster: 'health',
  title: {
    en: 'Body Fat Percentage Calculator',
    vi: 'Tính phần trăm mỡ cơ thể',
    es: 'Calculadora de porcentaje de grasa corporal',
    pt: 'Calculadora de percentual de gordura corporal',
  },
  description: {
    en: 'US Navy method body fat % from waist, neck, height (and hip for women). Quick estimate without calipers.',
    vi: 'Phần trăm mỡ cơ thể theo US Navy method từ eo, cổ, chiều cao (và hông cho nữ).',
    es: 'Porcentaje de grasa corporal con método US Navy de cintura, cuello, estatura (y cadera para mujeres).',
    pt: 'Percentual de gordura corporal pelo método US Navy de cintura, pescoço, altura (e quadril para mulheres).',
  },
  keywords: [
    'body fat percentage',
    'us navy method',
    'body fat calculator',
    'mỡ cơ thể',
    'grasa corporal',
  ],
  priority: 'P2',
  effort: 'M',
  published: true,
};
