import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'clip-path-generator',
  cluster: 'design',
  availableLocales: ['en'],
  title: {
    en: 'CSS Clip Path Generator',
    vi: 'Trình tạo clip-path CSS',
    es: 'Generador de clip-path CSS',
    pt: 'Gerador de clip-path CSS',
  },
  description: {
    en: 'Drag the vertices of a polygon, or set up a circle, ellipse or inset, and copy the clip-path declaration. Twelve preset shapes, percentage or px output.',
    vi: 'Kéo đỉnh polygon, hoặc chỉnh circle/ellipse/inset, rồi copy khai báo clip-path. 12 hình mẫu, xuất theo % hoặc px.',
    es: 'Arrastra los vértices de un polígono o define círculo, elipse o inset, y copia la declaración clip-path. Doce formas predefinidas.',
    pt: 'Arraste os vértices de um polígono ou defina círculo, elipse ou inset, e copie a declaração clip-path. Doze formas prontas.',
  },
  keywords: [
    'clip path generator',
    'css clip-path',
    'polygon clip path',
    'clip path maker',
    'css shapes',
    'clip-path circle inset',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    { tool: 'css-gradient-generator', reason: { en: 'Fill the clipped shape with a gradient' } },
    { tool: 'crop-image', reason: { en: 'Cut a real image instead of masking it in CSS' } },
    { tool: 'color-palette', reason: { en: 'Pick the colours the shape sits between' } },
  ],
};
