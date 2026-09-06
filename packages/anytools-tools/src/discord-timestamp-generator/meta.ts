import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'discord-timestamp-generator',
  cluster: 'time-date',
  // Widget strings are localized (strings.ts). Where no vi/es/pt FAQ body exists yet the
  // page serves noindex and stays out of the sitemap (has-localized-tool-body.ts).
  title: {
    en: 'Discord Timestamp Generator',
    vi: 'Trình tạo Timestamp Discord',
    es: 'Generador de marcas de tiempo de Discord',
    pt: 'Gerador de timestamp do Discord',
  },
  description: {
    en: 'Pick a date and time, get all seven Discord <t:UNIX:STYLE> codes plus a live preview of how each renders — the same code shows different text to readers in different time zones.',
    vi: 'Chọn ngày giờ, nhận đủ 7 mã <t:UNIX:STYLE> của Discord kèm xem trước — cùng một mã hiện khác nhau tuỳ múi giờ người đọc.',
    es: 'Elige fecha y hora, obtén los siete códigos <t:UNIX:STYLE> de Discord con vista previa — el mismo código se ve distinto según el huso horario de quien lo lee.',
    pt: 'Escolha data e hora, obtenha os sete códigos <t:UNIX:STYLE> do Discord com prévia — o mesmo código aparece diferente conforme o fuso de quem lê.',
  },
  keywords: [
    'discord timestamp generator',
    'discord unix timestamp',
    'discord time format',
    'discord relative time',
    'discord countdown timestamp',
    't:unix:style discord',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'timestamp-converter',
      reason: {
        en: 'Convert the Unix seconds back to a readable date, or the other way round',
        vi: 'Đổi giây Unix ngược lại thành ngày dễ đọc, hoặc ngược lại',
        es: 'Convierte los segundos Unix a una fecha legible, o al revés',
        pt: 'Converta os segundos Unix para uma data legível, ou o contrário',
      },
    },
    {
      tool: 'timezone-converter',
      reason: {
        en: 'Check what the picked time looks like across several time zones at once',
        vi: 'Xem giờ đã chọn trông thế nào ở nhiều múi giờ cùng lúc',
        es: 'Comprueba cómo se ve la hora elegida en varias zonas horarias a la vez',
        pt: 'Veja como o horário escolhido fica em vários fusos ao mesmo tempo',
      },
    },
  ],
};
