import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Timezone Converter',
  time: 'Time',
  fromTimezone: 'From timezone',
  now: 'Now',
  showIn: 'Show in',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Chuyển đổi múi giờ',
    time: 'Thời gian',
    fromTimezone: 'Từ múi giờ',
    now: 'Bây giờ',
    showIn: 'Hiển thị theo',
  },
  es: {
    title: 'Conversor de zonas horarias',
    time: 'Hora',
    fromTimezone: 'Zona horaria de origen',
    now: 'Ahora',
    showIn: 'Mostrar en',
  },
  pt: {
    title: 'Conversor de fuso horário',
    time: 'Horário',
    fromTimezone: 'Fuso horário de origem',
    now: 'Agora',
    showIn: 'Mostrar em',
  },
};
