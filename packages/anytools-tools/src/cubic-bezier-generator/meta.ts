import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'cubic-bezier-generator',
  cluster: 'design',
  // Widget strings are localized (strings.ts). Where no vi/es/pt FAQ body exists yet the
  // page serves noindex and stays out of the sitemap (has-localized-tool-body.ts).
  title: {
    en: 'Cubic Bezier Generator',
    vi: 'Trình tạo Cubic Bezier',
    es: 'Generador de Cubic Bezier',
    pt: 'Gerador de Cubic Bezier',
  },
  description: {
    en: 'Drag two control points on a live grid and watch a block animate with that exact easing. CSS keyword and overshoot presets, copy as transition-timing-function or a custom property.',
    vi: 'Kéo hai điểm điều khiển trên lưới và xem một khối chạy đúng theo easing đó. Có sẵn preset CSS và preset quá đà, copy dạng transition-timing-function hoặc biến CSS.',
    es: 'Arrastra dos puntos de control en una cuadrícula y mira un bloque animarse con ese easing exacto. Presets de CSS y de rebote, copia como transition-timing-function.',
    pt: 'Arraste dois pontos de controle numa grade e veja um bloco animar com esse easing exato. Predefinições de CSS e de exagero, copie como transition-timing-function.',
  },
  keywords: [
    'cubic bezier generator',
    'css easing generator',
    'transition timing function',
    'cubic-bezier css',
    'animation easing curve',
    'ease in out generator',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'css-gradient-generator',
      reason: {
        en: 'Animate a background between two gradients using this easing',
        vi: 'Chuyển động giữa hai gradient bằng easing này',
        es: 'Anima el fondo entre dos degradados con este easing',
        pt: 'Anime o fundo entre dois gradientes com esse easing',
      },
    },
    {
      tool: 'box-shadow-generator',
      reason: {
        en: 'Build the shadow this easing will transition into',
        vi: 'Tạo box-shadow để chuyển động tới bằng easing này',
        es: 'Crea la sombra a la que transicionará con este easing',
        pt: 'Crie a sombra para a qual essa transição vai',
      },
    },
    {
      tool: 'clip-path-generator',
      reason: {
        en: 'Shape a clip-path to animate with the same curve',
        vi: 'Tạo clip-path để chuyển động cùng đường cong này',
        es: 'Crea un clip-path para animar con la misma curva',
        pt: 'Crie um clip-path para animar com a mesma curva',
      },
    },
  ],
};
