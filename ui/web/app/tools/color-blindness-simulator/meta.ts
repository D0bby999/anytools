import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'color-blindness-simulator',
  cluster: 'design',
  // Widget strings are localized (strings.ts). Where no vi/es/pt FAQ body exists yet the
  // page serves noindex and stays out of the sitemap (has-localized-tool-body.ts).
  title: {
    en: 'Color Blindness Simulator',
    vi: 'Mô phỏng mù màu',
    es: 'Simulador de daltonismo',
    pt: 'Simulador de daltonismo',
  },
  description: {
    en: 'Upload a photo or enter a hex color and see it through protanopia, deuteranopia, tritanopia or achromatopsia. Side-by-side compare slider, matrices from the Brettel/Viénot-Mollon LMS model.',
    vi: 'Tải ảnh hoặc nhập mã màu, xem qua protanopia, deuteranopia, tritanopia hay achromatopsia. Có thanh so sánh, dùng ma trận LMS Brettel/Viénot-Mollon.',
    es: 'Sube una foto o escribe un color hex y velo con protanopía, deuteranopía, tritanopía o acromatopsia. Comparador lado a lado con matrices LMS de Brettel/Viénot-Mollon.',
    pt: 'Envie uma foto ou digite uma cor hex e veja com protanopia, deuteranopia, tritanopia ou acromatopsia. Comparador lado a lado com matrizes LMS de Brettel/Viénot-Mollon.',
  },
  keywords: [
    'color blindness simulator',
    'colorblind simulator',
    'protanopia simulator',
    'deuteranopia simulator',
    'tritanopia test',
    'daltonism simulator',
    'color vision deficiency',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'wcag-contrast-checker',
      reason: {
        en: 'A color pair readable by dichromats still needs enough contrast for everyone',
        vi: 'Cặp màu đọc được với người mù màu vẫn cần đủ tương phản cho mọi người',
        es: 'Un par de colores legible para dicromatas aún necesita contraste para todos',
        pt: 'Um par de cores legível para dicromatas ainda precisa de contraste para todos',
      },
    },
    {
      tool: 'color-palette',
      reason: {
        en: 'Build a palette, then check each pair here for color-only distinctions',
        vi: 'Dựng bảng màu rồi kiểm từng cặp ở đây xem có chỉ phân biệt bằng màu không',
        es: 'Crea una paleta y comprueba aquí cada par por distinciones solo de color',
        pt: 'Monte uma paleta e verifique aqui cada par por distinções só de cor',
      },
    },
    {
      tool: 'color-converter',
      reason: {
        en: 'Convert a passing color to RGB/HSL for your design tool',
        vi: 'Đổi màu đạt chuẩn sang RGB/HSL cho công cụ thiết kế',
        es: 'Convierte un color aprobado a RGB/HSL para tu herramienta de diseño',
        pt: 'Converta uma cor aprovada para RGB/HSL para sua ferramenta de design',
      },
    },
  ],
};
