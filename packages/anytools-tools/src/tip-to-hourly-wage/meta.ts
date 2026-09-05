import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'tip-to-hourly-wage',
  cluster: 'finance',
  title: {
    en: 'Tip-to-Hourly Wage Calculator',
    vi: 'Tính lương theo giờ từ tiền tip',
    es: 'Calculadora de tips a salario por hora',
    pt: 'Calculadora de gorjetas para salário por hora',
  },
  description: {
    en: 'Convert nightly tips + base wage + hours worked into effective hourly rate. For service workers.',
    vi: 'Quy đổi tiền tip mỗi ca + lương cơ bản + số giờ làm thành mức lương theo giờ thực nhận. Dành cho nhân viên dịch vụ.',
    es: 'Convierte las propinas de la noche + salario base + horas trabajadas en tu tarifa por hora real. Para trabajadores de servicios.',
    pt: 'Converte as gorjetas da noite + salário base + horas trabalhadas na sua taxa horária real. Para trabalhadores de serviços.',
  },
  keywords: ['tip wage calculator', 'effective hourly rate', 'service industry', 'restaurant wage'],
  priority: 'P3',
  effort: 'S',
  published: true,
  availableLocales: ['en'],
};
