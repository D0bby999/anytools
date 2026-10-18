import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'pomodoro-timer',
  cluster: 'lifestyle',
  title: {
    en: 'Pomodoro Timer',
    vi: 'Pomodoro Timer',
    es: 'Temporizador Pomodoro',
    pt: 'Temporizador Pomodoro',
  },
  description: {
    en: '25-minute focus blocks with 5-minute short breaks and 15-minute long breaks. Audio cue via Web Audio oscillator.',
    vi: 'Block focus 25 phút với break ngắn 5 phút và break dài 15 phút. Âm báo qua Web Audio oscillator.',
    es: 'Bloques de enfoque de 25 min con descansos cortos de 5 min y largos de 15 min. Sonido por Web Audio.',
    pt: 'Blocos de foco de 25 min com pausas curtas de 5 min e longas de 15 min. Som por Web Audio.',
  },
  keywords: ['pomodoro timer', 'focus timer', 'productivity', 'time management'],
  priority: 'P3',
  effort: 'S',
  published: true,
};
