import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'timestamp-converter',
  cluster: 'time-date',
  title: {
    en: 'Timestamp Converter',
    vi: 'Chuyển đổi Timestamp',
    es: 'Conversor de timestamps',
    pt: 'Conversor de timestamps',
  },
  description: {
    en: 'Convert between Unix seconds, milliseconds, ISO 8601, and timezone-aware human dates.',
    vi: 'Chuyển giữa Unix giây, milli giây, ISO 8601, và ngày người đọc theo timezone.',
    es: 'Convierte entre segundos Unix, milisegundos, ISO 8601 y fechas legibles con zona horaria.',
    pt: 'Converte entre segundos Unix, milissegundos, ISO 8601 e datas legíveis com fuso horário.',
  },
  keywords: [
    'timestamp',
    'unix timestamp',
    'epoch converter',
    'iso 8601',
    'timezone',
    'chuyển timestamp',
  ],
  priority: 'P1',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'jwt-decoder',
      reason: {
        en: 'Decode JWT to inspect its iat/exp timestamps',
        vi: 'Decode JWT để xem iat/exp',
      },
    },
    {
      tool: 'uuid-generator',
      reason: { en: 'Generate a UUID v7 (time-sorted)', vi: 'Tạo UUID v7 (sort theo thời gian)' },
    },
  ],
};
