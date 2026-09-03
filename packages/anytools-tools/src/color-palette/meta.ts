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
  nextStepSuggestions: [
    {
      tool: 'css-gradient-generator',
      reason: {
        en: 'Turn two palette colours into a gradient',
        vi: 'Biến hai màu trong bảng thành gradient',
        es: 'Convierte dos colores de la paleta en un degradado',
        pt: 'Transforme duas cores da paleta em um gradiente',
      },
    },
    {
      tool: 'clip-path-generator',
      reason: {
        en: 'Cut a shape out of a block filled with these colours',
        vi: 'Cắt hình từ khối màu vừa tạo',
        es: 'Recorta una forma de un bloque con estos colores',
        pt: 'Recorte uma forma de um bloco com estas cores',
      },
    },
    {
      tool: 'wcag-contrast-checker',
      reason: {
        en: 'Check which pairs in the palette are readable',
        vi: 'Kiểm tra cặp màu nào trong bảng đọc được',
        es: 'Comprueba qué pares de la paleta son legibles',
        pt: 'Verifique quais pares da paleta são legíveis',
      },
    },
  ],
};
