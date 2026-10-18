import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'stl-obj-viewer',
  cluster: 'design',
  title: {
    en: 'STL/OBJ Viewer',
    vi: 'Xem STL/OBJ',
    es: 'Visor STL/OBJ',
    pt: 'Visualizador STL/OBJ',
  },
  description: {
    en: 'Rotate, zoom and inspect a .stl or .obj 3D model — triangle count, bounding box, estimated volume, wireframe toggle, PNG snapshot. Runs in your browser, nothing is uploaded.',
    vi: 'Xoay, phóng to và xem file 3D .stl hay .obj — số tam giác, hộp bao, thể tích ước lượng, chế độ khung dây, chụp ảnh PNG. Chạy trong trình duyệt, không tải file lên.',
    es: 'Rota, haz zoom e inspecciona un modelo 3D .stl u .obj — triángulos, caja delimitadora, volumen estimado, modo alambre, captura PNG. Se ejecuta en tu navegador.',
    pt: 'Gire, dê zoom e inspecione um modelo 3D .stl ou .obj — triângulos, caixa delimitadora, volume estimado, modo wireframe, captura PNG. Roda no navegador.',
  },
  keywords: [
    'stl viewer online',
    'obj viewer online',
    '3d model viewer browser',
    'stl file inspector',
    'stl triangle count',
    'stl bounding box',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'image-to-base64',
      reason: {
        en: 'Embed a rendered PNG snapshot straight into HTML or CSS',
        vi: 'Nhúng ảnh PNG vừa chụp thẳng vào HTML hay CSS',
        es: 'Incrusta la captura PNG directamente en HTML o CSS',
        pt: 'Incorpore a captura PNG direto em HTML ou CSS',
      },
    },
    {
      tool: 'audio-trim',
      reason: {
        en: 'Another file viewer/editor that runs entirely offline',
        vi: 'Một công cụ xem/sửa file khác cũng chạy hoàn toàn offline',
        es: 'Otro visor/editor de archivos que funciona totalmente sin conexión',
        pt: 'Outro visualizador/editor de arquivo que roda totalmente offline',
      },
    },
  ],
};
