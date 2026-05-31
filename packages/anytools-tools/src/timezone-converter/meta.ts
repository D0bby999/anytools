import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'timezone-converter',
  cluster: 'time-date',
  title: { en: 'Timezone Converter', vi: 'Chuyển đổi Timezone' },
  description: {
    en: 'Convert a time between IANA timezones. Meeting planner across continents. Browser-only.',
    vi: 'Chuyển thời gian giữa IANA timezone. Lập lịch họp xuyên lục địa. Chỉ trong browser.',
  },
  keywords: ['timezone converter', 'meeting time', 'iana timezone', 'utc offset', 'world clock'],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'timestamp-converter',
      reason: { en: 'Convert to/from Unix timestamps', vi: 'Convert sang Unix timestamp' },
    },
    {
      tool: 'cron-parser',
      reason: { en: 'Schedule jobs across timezones', vi: 'Schedule job qua timezone' },
    },
  ],
};
