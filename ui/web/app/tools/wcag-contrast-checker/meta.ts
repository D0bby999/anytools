import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'wcag-contrast-checker',
  cluster: 'design',
  title: {
    en: 'WCAG Contrast Checker',
    vi: 'Kiểm tra độ tương phản WCAG',
    es: 'Verificador de Contraste WCAG',
    pt: 'Verificador de Contraste WCAG',
  },
  description: {
    en: 'Check color contrast against WCAG 2.2 AA/AAA — live preview, exact ratio, and an auto-suggested accessible color when your pair fails. 100% local.',
    vi: 'Kiểm tra tương phản màu theo WCAG 2.2 AA/AAA — xem trước trực tiếp, tỷ lệ chính xác, tự gợi ý màu đạt chuẩn khi cặp màu chưa đạt. 100% offline.',
    es: 'Comprueba el contraste de colores según WCAG 2.2 AA/AAA — vista previa en vivo, ratio exacto y color accesible sugerido automáticamente.',
    pt: 'Verifique o contraste de cores conforme WCAG 2.2 AA/AAA — prévia ao vivo, razão exata e cor acessível sugerida automaticamente.',
  },
  keywords: [
    'contrast checker',
    'wcag contrast',
    'color contrast',
    'accessibility checker',
    'aa aaa contrast',
    'contrast ratio',
    'kiểm tra tương phản',
    'contraste wcag',
    'contraste de cores',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'color-converter',
      reason: {
        en: 'Convert the passing color to RGB/HSL/OKLCH',
        vi: 'Đổi màu đạt chuẩn sang RGB/HSL/OKLCH',
        es: 'Convierte el color aprobado a RGB/HSL/OKLCH',
        pt: 'Converta a cor aprovada para RGB/HSL/OKLCH',
      },
    },
    {
      tool: 'color-palette',
      reason: {
        en: 'Build a full palette around your accessible pair',
        vi: 'Dựng bảng màu quanh cặp màu đạt chuẩn',
        es: 'Crea una paleta completa a partir del par accesible',
        pt: 'Monte uma paleta completa a partir do par acessível',
      },
    },
    {
      tool: 'css-gradient-generator',
      reason: {
        en: 'Text over a gradient: check it against the lightest and darkest stop',
        vi: 'Chữ trên gradient: kiểm tra với stop sáng nhất và tối nhất',
        es: 'Texto sobre degradado: compruébalo con la parada más clara y la más oscura',
        pt: 'Texto sobre gradiente: verifique com a parada mais clara e a mais escura',
      },
    },
  ],
};
