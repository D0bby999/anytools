import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'cron-parser',
  cluster: 'time-date',
  title: { en: 'Cron Parser', vi: 'Phân tích Cron' },
  description: {
    en: 'Parse cron expressions to human language. See next 10 scheduled runs. Browser-only.',
    vi: 'Phân tích cron expression sang ngôn ngữ người đọc. Xem 10 lần chạy tiếp theo. Chỉ trong browser.',
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
