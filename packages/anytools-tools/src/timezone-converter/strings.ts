import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Timezone Converter',
  time: 'Time',
  fromTimezone: 'From timezone',
  now: 'Now',
  showIn: 'Show in',
  error_isoFormat: 'Use ISO format: YYYY-MM-DDTHH:mm',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Chuyển đổi múi giờ',
    time: 'Thời gian',
    fromTimezone: 'Từ múi giờ',
    now: 'Bây giờ',
    showIn: 'Hiển thị theo',
    error_isoFormat: 'Dùng định dạng ISO: YYYY-MM-DDTHH:mm',
  },
  es: {
    title: 'Conversor de zonas horarias',
    time: 'Hora',
    fromTimezone: 'Zona horaria de origen',
    now: 'Ahora',
    showIn: 'Mostrar en',
    error_isoFormat: 'Usa el formato ISO: YYYY-MM-DDTHH:mm',
  },
  pt: {
    title: 'Conversor de fuso horário',
    time: 'Horário',
    fromTimezone: 'Fuso horário de origem',
    now: 'Agora',
    showIn: 'Mostrar em',
    error_isoFormat: 'Use o formato ISO: YYYY-MM-DDTHH:mm',
  },
};
