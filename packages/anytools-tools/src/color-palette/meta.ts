import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'color-palette',
  cluster: 'design',
  title: {
    en: 'Color Palette Generator',
    vi: 'Color Palette Generator',
    es: 'Generador de paleta de colores',
    pt: 'Gerador de paleta de cores',
  },
  description: {
    en: 'Generate harmonized palettes: analogous, complementary, triadic, monochromatic. From a single seed color.',
    vi: 'Generate harmonized palette: analogous, complementary, triadic, monochromatic. Từ 1 seed color.',
    es: 'Genera paletas armonizadas: análoga, complementaria, triádica, monocromática.',
    pt: 'Gere paletas harmonizadas: análoga, complementar, triádica, monocromática.',
  },
  keywords: ['color palette generator', 'analogous', 'complementary', 'triadic', 'color harmony'],
  priority: 'P2',
  effort: 'M',
  published: true,
};
