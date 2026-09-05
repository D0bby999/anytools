import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'whiteboard',
  cluster: 'design',
  title: {
    en: 'Online Whiteboard',
    vi: 'Bảng vẽ trực tuyến',
    es: 'Pizarra en línea',
    pt: 'Quadro branco online',
  },
  description: {
    en: 'Sketch diagrams and wireframes in the browser. Saved in this browser only — no account, no sync, nothing uploaded.',
    vi: 'Vẽ sơ đồ, wireframe ngay trong trình duyệt. Lưu trong máy, không tài khoản, không đồng bộ.',
    es: 'Dibuja diagramas y wireframes en el navegador. Se guarda solo en este navegador, sin cuenta.',
    pt: 'Desenhe diagramas e wireframes no navegador. Salvo apenas neste navegador, sem conta.',
  },
  keywords: [
    'online whiteboard',
    'excalidraw',
    'draw diagram online free no signup',
    'sketch diagram in browser',
    'virtual whiteboard no account',
    'hand drawn wireframe tool',
  ],
  priority: 'P3',
  effort: 'S',
  published: true,
  // Widget strings are localized (strings.ts). Where no vi/es/pt FAQ body exists yet the
  // page serves noindex and stays out of the sitemap (has-localized-tool-body.ts).
  nextStepSuggestions: [
    {
      tool: 'color-palette',
      reason: {
        en: 'Build a colour set before you draw, then paste the hex codes into the board',
        vi: 'Tạo bộ màu trước khi vẽ rồi dán mã hex vào bảng',
        es: 'Crea un conjunto de colores y pega los códigos hex en la pizarra',
        pt: 'Monte um conjunto de cores e cole os códigos hex no quadro',
      },
    },
    {
      tool: 'css-gradient-generator',
      reason: {
        en: 'Turn a sketched background into a CSS gradient you can ship',
        vi: 'Biến nền vừa phác thành CSS gradient dùng được',
        es: 'Convierte el fondo que dibujaste en un degradado CSS',
        pt: 'Transforme o fundo esboçado em um gradiente CSS',
      },
    },
    {
      tool: 'compress-image',
      reason: {
        en: 'Shrink the exported PNG before attaching it anywhere',
        vi: 'Nén ảnh PNG vừa xuất trước khi gửi đi',
        es: 'Reduce el PNG exportado antes de adjuntarlo',
        pt: 'Reduza o PNG exportado antes de anexá-lo',
      },
    },
  ],
};
