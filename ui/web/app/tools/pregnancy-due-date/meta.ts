import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'pregnancy-due-date',
  cluster: 'health',
  title: {
    en: 'Pregnancy Due Date Calculator',
    vi: 'Tính ngày dự sinh',
    es: 'Calculadora de fecha de parto',
    pt: 'Calculadora de data prevista para o parto',
  },
  description: {
    en: "Estimated due date from last menstrual period (Naegele's rule, 40 weeks). For information only — not medical advice.",
    vi: 'Ngày dự sinh ước tính từ kỳ kinh cuối (Naegele rule, 40 tuần). Chỉ tham khảo — không phải lời khuyên y tế.',
    es: 'Fecha estimada del parto desde último período (regla de Naegele, 40 semanas). Solo informativo.',
    pt: 'Data estimada do parto a partir da última menstruação (regra de Naegele, 40 semanas). Apenas informativo.',
  },
  keywords: ['pregnancy due date', 'naegele rule', 'edd calculator', 'ngày dự sinh', 'fecha parto'],
  priority: 'P3',
  effort: 'S',
  published: true,
};
