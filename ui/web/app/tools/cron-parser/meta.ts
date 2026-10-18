import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'cron-parser',
  cluster: 'time-date',
  title: {
    en: 'Cron Parser',
    vi: 'Phân tích Cron',
    es: 'Analizador de Cron',
    pt: 'Analisador de Cron',
  },
  description: {
    en: 'Parse cron expressions to human language. See next 10 scheduled runs. Browser-only.',
    vi: 'Phân tích cron expression sang ngôn ngữ người đọc. Xem 10 lần chạy tiếp theo. Chỉ trong browser.',
    es: 'Traduce expresiones cron a lenguaje humano. Muestra las próximas 10 ejecuciones. Solo en el navegador.',
    pt: 'Traduz expressões cron para linguagem humana. Mostra as próximas 10 execuções. Só no navegador.',
  },
  keywords: ['cron', 'cron parser', 'cron expression', 'crontab', 'scheduled task'],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'timestamp-converter',
      reason: {
        en: 'Convert run timestamps to your timezone',
        vi: 'Convert thời gian sang timezone',
      },
    },
    {
      tool: 'timezone-converter',
      reason: { en: 'Schedule cron in different timezones', vi: 'Schedule cron ở timezone khác' },
    },
  ],
};
