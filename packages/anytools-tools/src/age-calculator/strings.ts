import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Age Calculator',
  description: 'Exact age from birth date.',
  birthDate: 'Birth date',
  age: 'Age',
  ageValue: '{y} years {m} months {d} days',
  totalDays: 'Total days',
  totalHours: 'Total hours',
  totalMinutes: 'Total minutes',
  pickPastDate: 'Pick a date in the past.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Tính tuổi',
    description: 'Tuổi chính xác từ ngày sinh.',
    birthDate: 'Ngày sinh',
    age: 'Tuổi',
    ageValue: '{y} năm {m} tháng {d} ngày',
    totalDays: 'Tổng số ngày',
    totalHours: 'Tổng số giờ',
    totalMinutes: 'Tổng số phút',
    pickPastDate: 'Chọn một ngày trong quá khứ.',
  },
  es: {
    title: 'Calculadora de edad',
    description: 'Edad exacta a partir de la fecha de nacimiento.',
    birthDate: 'Fecha de nacimiento',
    age: 'Edad',
    ageValue: '{y} años {m} meses {d} días',
    totalDays: 'Días totales',
    totalHours: 'Horas totales',
    totalMinutes: 'Minutos totales',
    pickPastDate: 'Elige una fecha en el pasado.',
  },
  pt: {
    title: 'Calculadora de idade',
    description: 'Idade exata a partir da data de nascimento.',
    birthDate: 'Data de nascimento',
    age: 'Idade',
    ageValue: '{y} anos {m} meses {d} dias',
    totalDays: 'Total de dias',
    totalHours: 'Total de horas',
    totalMinutes: 'Total de minutos',
    pickPastDate: 'Escolha uma data no passado.',
  },
};
