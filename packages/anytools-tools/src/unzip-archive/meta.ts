import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'unzip-archive',
  cluster: 'converters',
  availableLocales: ['en'],
  title: {
    en: 'Unzip Archive',
    vi: 'Giải Nén File',
    es: 'Descomprimir Archivo',
    pt: 'Descompactar Arquivo',
  },
  description: {
    en: 'Open a .zip, .7z, .rar, .tar or .tar.gz and pull out the files you need. Runs in your browser — the archive is never uploaded.',
    vi: 'Mở .zip, .7z, .rar, .tar hay .tar.gz và lấy file bên trong. Chạy trong trình duyệt, không tải file lên.',
    es: 'Abre un .zip, .7z, .rar, .tar o .tar.gz y saca los archivos que necesites. Se ejecuta en tu navegador.',
    pt: 'Abra um .zip, .7z, .rar, .tar ou .tar.gz e retire os arquivos que precisa. Roda no navegador.',
  },
  keywords: [
    'unzip online',
    'open rar file',
    'extract 7z',
    'unzip without software',
    'open tar gz in browser',
    'extract password protected zip',
  ],
  priority: 'P1',
  effort: 'L',
  nextStepSuggestions: [
    {
      tool: 'create-zip',
      reason: {
        en: 'Bundle files back into a new .zip',
        vi: 'Gộp file lại thành .zip mới',
        es: 'Volver a empaquetar en un .zip',
        pt: 'Empacotar de volta num .zip',
      },
    },
    {
      tool: 'pdf-to-png',
      reason: {
        en: 'It hands back a zip of page images — open it here',
        vi: 'Công cụ đó trả về zip ảnh trang — mở ở đây',
        es: 'Devuelve un zip de imágenes de páginas — ábrelo aquí',
        pt: 'Devolve um zip com as páginas — abra aqui',
      },
    },
  ],
};
