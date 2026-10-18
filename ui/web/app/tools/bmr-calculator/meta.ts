import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'bmr-calculator',
  cluster: 'health',
  title: {
    en: 'BMR Calculator',
    vi: 'Tính BMR',
    es: 'Calculadora de BMR',
    pt: 'Calculadora de BMR',
  },
  description: {
    en: 'Basal Metabolic Rate calculator using the Mifflin–St Jeor equation. Daily calorie burn at complete rest.',
    vi: 'Tính BMR (tỷ lệ trao đổi chất cơ bản) dùng công thức Mifflin–St Jeor. Calo đốt mỗi ngày khi nghỉ hoàn toàn.',
    es: 'Calculadora de BMR (tasa metabólica basal) con ecuación Mifflin–St Jeor. Calorías diarias en reposo.',
    pt: 'Calculadora de BMR (taxa metabólica basal) com equação Mifflin–St Jeor. Calorias diárias em repouso.',
  },
  keywords: ['bmr', 'basal metabolic rate', 'mifflin st jeor', 'tính bmr', 'metabolismo basal'],
  priority: 'P2',
  effort: 'S',
  published: true,
};
