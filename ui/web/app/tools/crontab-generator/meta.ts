import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'crontab-generator',
  cluster: 'time-date',
  title: {
    en: 'Crontab Generator',
    vi: 'Tạo biểu thức Crontab',
    es: 'Generador de Crontab',
    pt: 'Gerador de Crontab',
  },
  description: {
    en: 'Build cron expressions visually — presets for common schedules, per-field editing, plain-English description, and the next 5 run times. 100% local.',
    vi: 'Tạo biểu thức cron trực quan — preset lịch phổ biến, sửa từng trường, mô tả dễ hiểu và 5 lần chạy kế tiếp. 100% offline.',
    es: 'Crea expresiones cron visualmente — presets comunes, edición por campo, descripción clara y las próximas 5 ejecuciones.',
    pt: 'Crie expressões cron visualmente — presets comuns, edição por campo, descrição clara e as próximas 5 execuções.',
  },
  keywords: [
    'crontab generator',
    'cron generator',
    'cron expression builder',
    'cron schedule',
    'crontab maker',
    'tạo cron',
    'generador cron',
    'gerador cron',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'cron-parser',
      reason: {
        en: 'Paste any existing cron expression to decode it',
        vi: 'Dán biểu thức cron có sẵn để giải mã',
        es: 'Pega una expresión cron existente para decodificarla',
        pt: 'Cole uma expressão cron existente para decodificá-la',
      },
    },
    {
      tool: 'timezone-converter',
      reason: {
        en: 'Convert the run times to your server timezone',
        vi: 'Đổi giờ chạy sang múi giờ server của bạn',
        es: 'Convierte los horarios a la zona horaria de tu servidor',
        pt: 'Converta os horários para o fuso do seu servidor',
      },
    },
  ],
};
