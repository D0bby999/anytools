import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'box-shadow-generator',
  cluster: 'design',
  availableLocales: ['en'],
  title: {
    en: 'Box Shadow Generator',
    vi: 'Trình tạo box-shadow CSS',
    es: 'Generador de box-shadow CSS',
    pt: 'Gerador de box-shadow CSS',
  },
  description: {
    en: 'Stack as many shadow layers as you need — offset, blur, spread, colour, inset — and see them on a light and a dark card at once. Copy the CSS or the Tailwind arbitrary value.',
    vi: 'Xếp nhiều lớp shadow (offset, blur, spread, màu, inset), xem trước trên nền sáng và tối cùng lúc. Copy CSS hoặc giá trị Tailwind.',
    es: 'Apila las capas de sombra que necesites y compáralas sobre fondo claro y oscuro a la vez. Copia el CSS o el valor arbitrario de Tailwind.',
    pt: 'Empilhe quantas camadas de sombra precisar e veja-as em fundo claro e escuro ao mesmo tempo. Copie o CSS ou o valor arbitrário do Tailwind.',
  },
  keywords: [
    'box shadow generator',
    'css box-shadow',
    'multiple shadow layers',
    'inset shadow',
    'material elevation shadow',
    'tailwind shadow',
    'drop shadow css',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    { tool: 'css-gradient-generator', reason: { en: 'Build the surface the shadow sits on' } },
    { tool: 'color-converter', reason: { en: 'Convert the shadow colour to RGB or HSL' } },
    {
      tool: 'wcag-contrast-checker',
      reason: { en: 'A shadow is not contrast — check the real text pair' },
    },
  ],
};
