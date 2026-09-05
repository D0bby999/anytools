import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Sleep Calculator',
  description: '90-minute REM cycles + 14 min to fall asleep.',
  wakeUpAt: 'I want to wake up at',
  sleepAt: 'I plan to sleep at',
  mode: 'Mode',
  targetWakeTime: 'Target wake-up time',
  bedtime: 'Bedtime',
  timeAria: 'Time',
  suggestedBedtimes: 'Suggested bedtimes',
  suggestedWakeTimes: 'Suggested wake-up times',
  cyclesLabel: '{n} cycles ({time})',
  disclaimer:
    'Estimates. Individual sleep cycles range 70-120 min; sleep quality matters more than exact timing.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Máy tính giấc ngủ',
    description: 'Chu kỳ REM 90 phút + 14 phút để chìm vào giấc ngủ.',
    wakeUpAt: 'Tôi muốn thức dậy lúc',
    sleepAt: 'Tôi định đi ngủ lúc',
    mode: 'Chế độ',
    targetWakeTime: 'Giờ muốn thức dậy',
    bedtime: 'Giờ đi ngủ',
    timeAria: 'Giờ',
    suggestedBedtimes: 'Giờ đi ngủ gợi ý',
    suggestedWakeTimes: 'Giờ thức dậy gợi ý',
    cyclesLabel: '{n} chu kỳ ({time})',
    disclaimer:
      'Chỉ là ước tính. Chu kỳ ngủ mỗi người dao động 70-120 phút; chất lượng giấc ngủ quan trọng hơn giờ giấc chính xác.',
  },
  es: {
    title: 'Calculadora de sueño',
    description: 'Ciclos REM de 90 minutos + 14 min para dormirse.',
    wakeUpAt: 'Quiero despertarme a las',
    sleepAt: 'Pienso acostarme a las',
    mode: 'Modo',
    targetWakeTime: 'Hora deseada para despertar',
    bedtime: 'Hora de acostarse',
    timeAria: 'Hora',
    suggestedBedtimes: 'Horas sugeridas para acostarse',
    suggestedWakeTimes: 'Horas sugeridas para despertar',
    cyclesLabel: '{n} ciclos ({time})',
    disclaimer:
      'Estimaciones. Los ciclos de sueño varían entre 70 y 120 min según la persona; la calidad del sueño importa más que la hora exacta.',
  },
  pt: {
    title: 'Calculadora de sono',
    description: 'Ciclos REM de 90 minutos + 14 min para adormecer.',
    wakeUpAt: 'Quero acordar às',
    sleepAt: 'Pretendo dormir às',
    mode: 'Modo',
    targetWakeTime: 'Hora desejada para acordar',
    bedtime: 'Hora de dormir',
    timeAria: 'Hora',
    suggestedBedtimes: 'Horários sugeridos para dormir',
    suggestedWakeTimes: 'Horários sugeridos para acordar',
    cyclesLabel: '{n} ciclos ({time})',
    disclaimer:
      'Estimativas. Os ciclos de sono variam de 70 a 120 min por pessoa; a qualidade do sono importa mais do que o horário exato.',
  },
};
