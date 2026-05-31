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
};
