import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'css-gradient-generator',
  cluster: 'design',
  availableLocales: ['en'],
  title: {
    en: 'CSS Gradient Generator',
    vi: 'Trình tạo gradient CSS',
    es: 'Generador de degradados CSS',
    pt: 'Gerador de gradientes CSS',
  },
  description: {
    en: 'Build linear, radial and conic gradients with as many colour stops as you need. Copy the CSS with a flat-colour fallback, or the Tailwind arbitrary value — and paste existing CSS back in to edit it.',
    vi: 'Tạo gradient linear, radial, conic với số color stop tuỳ ý. Copy CSS kèm fallback màu phẳng hoặc giá trị Tailwind.',
    es: 'Crea degradados lineales, radiales y cónicos con los puntos de color que necesites. Copia el CSS con color de reserva o el valor arbitrario de Tailwind.',
    pt: 'Crie gradientes lineares, radiais e cônicos com quantas paradas de cor precisar. Copie o CSS com cor de reserva ou o valor arbitrário do Tailwind.',
  },
  keywords: [
    'css gradient generator',
    'linear-gradient',
    'radial-gradient',
    'conic-gradient',
    'gradient css code',
    'tailwind gradient',
    'repeating gradient',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    { tool: 'color-palette', reason: { en: 'Pick harmonised stop colours from one seed' } },
    { tool: 'color-converter', reason: { en: 'Convert a stop between HEX, RGB and HSL' } },
    {
      tool: 'wcag-contrast-checker',
      reason: { en: 'Check text over the gradient against its darkest stop' },
    },
    {
      tool: 'whiteboard',
      reason: { en: 'Sketch the screen this gradient sits on before writing any CSS' },
    },
  ],
};
