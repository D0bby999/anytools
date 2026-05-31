import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'triangle-calculator',
  cluster: 'lifestyle',
  title: {
    en: 'Triangle Calculator',
    vi: 'Calculator tam giác',
    es: 'Calculadora de triángulo',
    pt: 'Calculadora de triângulo',
  },
  description: {
    en: 'Solve a triangle: three sides → angles + area (Heron). Pythagorean check for right triangles.',
    vi: 'Giải tam giác: 3 cạnh → các góc + diện tích (Heron). Kiểm tra Pythagore.',
    es: 'Resuelve un triángulo: tres lados → ángulos + área (Herón). Comprobación pitagórica.',
    pt: 'Resolva um triângulo: três lados → ângulos + área (Herão). Verificação pitagórica.',
  },
  keywords: [
    'triangle calculator',
    'heron formula',
    'pythagorean theorem',
    'tam giác',
    'triángulo',
  ],
  priority: 'P3',
  effort: 'S',
  published: true,
};
