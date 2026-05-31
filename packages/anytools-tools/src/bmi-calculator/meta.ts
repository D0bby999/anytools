import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'bmi-calculator',
  cluster: 'health',
  title: {
    en: 'BMI Calculator',
    vi: 'Tính BMI',
    es: 'Calculadora de IMC',
    pt: 'Calculadora de IMC',
  },
  description: {
    en: 'Free BMI calculator with metric + imperial units. Shows category from underweight to obese class III. For estimation only.',
    vi: 'Tính BMI miễn phí với đơn vị metric + imperial. Hiện category từ thiếu cân đến béo phì độ III. Chỉ để ước tính.',
    es: 'Calculadora de IMC gratis con métrico + imperial. Muestra categoría de bajo peso a obesidad clase III. Solo estimación.',
    pt: 'Calculadora de IMC grátis com métrico + imperial. Mostra categoria de baixo peso a obesidade classe III. Apenas estimativa.',
  },
  keywords: [
    'bmi',
    'bmi calculator',
    'body mass index',
    'weight category',
    'metric imperial',
    'tính bmi',
    'chỉ số khối cơ thể',
    'calculadora imc',
    'índice de masa corporal',
  ],
  priority: 'P1',
  effort: 'S',
  published: true,
};
