import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Date Difference',
  description: 'Years, months, days between two dates.',
  startDate: 'Start date',
  endDate: 'End date',
  duration: 'Duration',
  durationValue: '{y}y {m}m {d}d',
  totalWeeks: 'Total weeks',
  totalDays: 'Total days',
  totalHours: 'Total hours',
  pickValidDates: 'Pick valid start + end dates.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Khoảng cách giữa hai ngày',
    description: 'Số năm, tháng, ngày giữa hai mốc thời gian.',
    startDate: 'Ngày bắt đầu',
    endDate: 'Ngày kết thúc',
    duration: 'Khoảng cách',
    durationValue: '{y} năm {m} tháng {d} ngày',
    totalWeeks: 'Tổng số tuần',
    totalDays: 'Tổng số ngày',
    totalHours: 'Tổng số giờ',
    pickValidDates: 'Chọn ngày bắt đầu và kết thúc hợp lệ.',
  },
  es: {
    title: 'Diferencia entre fechas',
    description: 'Años, meses y días entre dos fechas.',
    startDate: 'Fecha de inicio',
    endDate: 'Fecha de fin',
    duration: 'Duración',
    durationValue: '{y} a {m} m {d} d',
    totalWeeks: 'Semanas totales',
    totalDays: 'Días totales',
    totalHours: 'Horas totales',
    pickValidDates: 'Elige fechas de inicio y fin válidas.',
  },
  pt: {
    title: 'Diferença entre datas',
    description: 'Anos, meses e dias entre duas datas.',
    startDate: 'Data inicial',
    endDate: 'Data final',
    duration: 'Duração',
    durationValue: '{y} a {m} m {d} d',
    totalWeeks: 'Total de semanas',
    totalDays: 'Total de dias',
    totalHours: 'Total de horas',
    pickValidDates: 'Escolha datas inicial e final válidas.',
  },
};
