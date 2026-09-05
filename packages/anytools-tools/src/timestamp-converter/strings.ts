import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Timestamp Converter',
  inputLabel: 'Input — Unix seconds, millis, ISO 8601, or RFC 2822',
  now: 'Now',
  timezone: 'Timezone',
  enterHint: 'Enter a timestamp to convert.',
  parseFailed: 'Parse failed',
  detected: 'Detected',
  unixSeconds: 'Unix seconds',
  unixMillis: 'Unix millis',
  // {zone} is an IANA timezone id such as Asia/Ho_Chi_Minh.
  inZone: 'In {zone}',
  relative: 'Relative',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Chuyển đổi timestamp',
    inputLabel: 'Đầu vào — giây Unix, mili giây, ISO 8601 hoặc RFC 2822',
    now: 'Bây giờ',
    timezone: 'Múi giờ',
    enterHint: 'Nhập một timestamp để chuyển đổi.',
    parseFailed: 'Phân tích thất bại',
    detected: 'Nhận diện',
    unixSeconds: 'Giây Unix',
    unixMillis: 'Mili giây Unix',
    inZone: 'Theo {zone}',
    relative: 'Tương đối',
  },
  es: {
    title: 'Conversor de timestamps',
    inputLabel: 'Entrada — segundos Unix, milisegundos, ISO 8601 o RFC 2822',
    now: 'Ahora',
    timezone: 'Zona horaria',
    enterHint: 'Introduce un timestamp para convertirlo.',
    parseFailed: 'No se pudo interpretar',
    detected: 'Detectado',
    unixSeconds: 'Segundos Unix',
    unixMillis: 'Milisegundos Unix',
    inZone: 'En {zone}',
    relative: 'Relativo',
  },
  pt: {
    title: 'Conversor de timestamp',
    inputLabel: 'Entrada — segundos Unix, milissegundos, ISO 8601 ou RFC 2822',
    now: 'Agora',
    timezone: 'Fuso horário',
    enterHint: 'Digite um timestamp para converter.',
    parseFailed: 'Falha ao interpretar',
    detected: 'Detectado',
    unixSeconds: 'Segundos Unix',
    unixMillis: 'Milissegundos Unix',
    inZone: 'Em {zone}',
    relative: 'Relativo',
  },
};
