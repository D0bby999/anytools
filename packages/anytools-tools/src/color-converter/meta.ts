import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'color-converter',
  cluster: 'design',
  title: {
    en: 'Color Converter & Contrast Checker',
    vi: 'Color converter & kiểm tra contrast',
    es: 'Conversor de color y verificador de contraste',
    pt: 'Conversor de cor e verificador de contraste',
  },
  description: {
    en: 'HEX ↔ RGB ↔ HSL color converter with WCAG AA/AAA contrast checker. For designers and accessibility audits.',
    vi: 'HEX ↔ RGB ↔ HSL converter với WCAG AA/AAA contrast checker. Cho designer và audit accessibility.',
    es: 'Conversor HEX ↔ RGB ↔ HSL con verificador de contraste WCAG AA/AAA.',
    pt: 'Conversor HEX ↔ RGB ↔ HSL com verificador de contraste WCAG AA/AAA.',
  },
  keywords: ['color converter', 'hex rgb hsl', 'wcag contrast', 'accessibility', 'color picker'],
  priority: 'P1',
  effort: 'S',
  published: true,
  nextStepSuggestions: [
    {
      tool: 'css-gradient-generator',
      reason: {
        en: 'Blend this colour into a linear, radial or conic gradient',
        vi: 'Trộn màu này thành gradient linear, radial hoặc conic',
        es: 'Combina este color en un degradado lineal, radial o cónico',
        pt: 'Combine esta cor em um gradiente linear, radial ou cônico',
      },
    },
    {
      tool: 'color-palette',
      reason: {
        en: 'Build a harmonised palette around it',
        vi: 'Dựng bảng màu hài hoà quanh nó',
        es: 'Crea una paleta armonizada a su alrededor',
        pt: 'Monte uma paleta harmonizada em torno dela',
      },
    },
  ],
};
